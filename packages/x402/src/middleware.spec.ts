import { jest } from '@jest/globals';
import { gateRequest } from './middleware.js';
import { paymentMiddleware } from './express.js';
import type { FacilitatorClient } from './client.js';
import type { RouteRequirements, VerifyResponseBody, SettleResponseBody } from './types.js';

const route: RouteRequirements = {
  scheme: 'permit2_exact',
  chain: 'bnb',
  network: 'mainnet',
  asset: '0x55d398326f99059ff775485246999027b3197955',
  amountAtomic: 5000000000000000000n,
  payTo: '0xMERCHANT',
  resource: 'https://api.example.com/report',
  maxTimeoutSeconds: 300,
};

function makeClient(overrides?: Partial<FacilitatorClient>): FacilitatorClient {
  return {
    verify: jest.fn(async (): Promise<VerifyResponseBody> => ({ valid: true })),
    settle: jest.fn(async (): Promise<SettleResponseBody> => ({ success: true, txHash: '0xTX' })),
    supported: jest.fn(async () => ({ kinds: [] })),
    ...overrides,
  } as unknown as FacilitatorClient;
}

describe('gateRequest', () => {
  it('returns a challenge when no payment header is present', async () => {
    const client = makeClient();
    const result = await gateRequest({}, route, client, { mppSecret: 'shared-secret' });

    expect(result.kind).toBe('challenge');
    if (result.kind !== 'challenge') throw new Error('expected challenge');
    expect(result.status).toBe(402);
    expect(result.headers['PAYMENT-REQUIRED']).toBeTruthy();
    expect(result.headers['WWW-Authenticate']).toMatch(/^Payment /);
    expect(client.settle).not.toHaveBeenCalled();
    expect(client.verify).not.toHaveBeenCalled();
  });

  it('advertises x402 only — never a guessable MPP binding — when no mppSecret is configured', async () => {
    const client = makeClient();
    const result = await gateRequest({}, route, client);

    expect(result.kind).toBe('challenge');
    if (result.kind !== 'challenge') throw new Error('expected challenge');
    expect(result.headers['PAYMENT-REQUIRED']).toBeTruthy();
    // Regression guard: a placeholder default secret here used to produce an MPP challenge that
    // Thru could never verify, so every MPP payment failed with `binding mismatch` while x402
    // worked. Advertising nothing is correct; advertising an unverifiable challenge is not.
    expect(result.headers['WWW-Authenticate']).toBeUndefined();
  });

  it('rejects an MPP credential outright when no mppSecret is configured', async () => {
    const client = makeClient();
    const result = await gateRequest(
      { authorization: 'Payment intent="charge", binding="deadbeef"' },
      route,
      client,
    );

    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('expected error');
    expect(result.status).toBe(402);
    expect(result.body.reason).toBe('mpp_not_configured');
    // The facilitator must not be asked to decode a credential we never bound.
    expect(client.settle).not.toHaveBeenCalled();
    expect(client.verify).not.toHaveBeenCalled();
  });

  it('settles and proceeds when a payment header is present and settlement succeeds', async () => {
    const client = makeClient({
      settle: jest.fn(async (): Promise<SettleResponseBody> => ({ success: true, txHash: '0xTX', paymentId: 'p1' })),
    });
    const result = await gateRequest({ 'PAYMENT-SIGNATURE': 'b64envelope' }, route, client);

    expect(client.settle).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('proceed');
    if (result.kind !== 'proceed') throw new Error('expected proceed');
    expect(result.responseHeaders['PAYMENT-RESPONSE']).toBeTruthy();
  });

  it('calls verify instead of settle when verifyOnly is set', async () => {
    const client = makeClient({
      verify: jest.fn(async (): Promise<VerifyResponseBody> => ({ valid: true, payer: '0xPAYER' })),
    });
    const result = await gateRequest({ 'PAYMENT-SIGNATURE': 'b64envelope' }, route, client, { verifyOnly: true });

    expect(client.verify).toHaveBeenCalledTimes(1);
    expect(client.settle).not.toHaveBeenCalled();
    expect(result.kind).toBe('proceed');
  });

  it('returns a fresh 402 challenge when the facilitator rejects the payment', async () => {
    const client = makeClient({
      settle: jest.fn(async (): Promise<SettleResponseBody> => ({ success: false, reason: 'payto_mismatch' })),
    });
    const result = await gateRequest({ 'PAYMENT-SIGNATURE': 'b64envelope' }, route, client, {
      mppSecret: 'shared-secret',
    });

    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('expected error');
    expect(result.status).toBe(402);
    expect(result.body.reason).toBe('payto_mismatch');
    expect(result.headers['PAYMENT-REQUIRED']).toBeTruthy();
    expect(result.headers['WWW-Authenticate']).toMatch(/^Payment /);
  });

  it('returns a 502 error when the facilitator call throws (network failure)', async () => {
    const client = makeClient({
      settle: jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    });
    const result = await gateRequest({ 'PAYMENT-SIGNATURE': 'b64envelope' }, route, client);

    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('expected error');
    expect(result.status).toBe(502);
    expect(result.body.reason).toBeTruthy();
  });
});

describe('paymentMiddleware (express adapter)', () => {
  function makeReqRes(method: string, path: string, headers: Record<string, string> = {}) {
    const req: any = { method, path, headers };
    const res: any = {
      statusCode: 200,
      _headers: {} as Record<string, string>,
      _body: undefined as unknown,
      set(key: string, value: string) {
        this._headers[key] = value;
        return this;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this._body = body;
        return this;
      },
    };
    const next = jest.fn();
    return { req, res, next };
  }

  it('passes through untouched requests to unmatched routes', async () => {
    const client = makeClient();
    const handler = paymentMiddleware({ 'GET /paid': route }, client);
    const { req, res, next } = makeReqRes('GET', '/unpaid');

    await handler(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(client.verify).not.toHaveBeenCalled();
    expect(client.settle).not.toHaveBeenCalled();
  });

  it('responds 402 with both challenge headers when no payment header is present on a matched route', async () => {
    const client = makeClient();
    const handler = paymentMiddleware({ 'GET /paid': route }, client, { mppSecret: 'shared-secret' });
    const { req, res, next } = makeReqRes('GET', '/paid');

    await handler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(402);
    expect(res._headers['PAYMENT-REQUIRED']).toBeTruthy();
    expect(res._headers['WWW-Authenticate']).toMatch(/^Payment /);
  });

  it('calls next() and sets the PAYMENT-RESPONSE header on a successful paid request', async () => {
    const client = makeClient();
    const handler = paymentMiddleware({ 'GET /paid': route }, client);
    const { req, res, next } = makeReqRes('GET', '/paid', { 'payment-signature': 'b64envelope' });

    await handler(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res._headers['PAYMENT-RESPONSE']).toBeTruthy();
  });
});
