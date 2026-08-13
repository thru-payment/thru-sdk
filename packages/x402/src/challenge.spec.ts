import { buildChallengeHeaders, extractPayment, decodeRequirementsFromHeader } from './challenge.js';
import type { RouteRequirements } from './types.js';

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

describe('buildChallengeHeaders', () => {
  it('emits both the x402 PAYMENT-REQUIRED header and the MPP WWW-Authenticate header', () => {
    const headers = buildChallengeHeaders(route, { mppSecret: 'secret' });
    expect(headers['PAYMENT-REQUIRED']).toBeTruthy();
    expect(headers['WWW-Authenticate']).toMatch(/^Payment /);
  });

  it('omits the MPP challenge entirely when no secret is supplied', () => {
    // The MPP binding is only meaningful if Thru can re-derive it. Emitting one keyed by a
    // placeholder produces a challenge that always fails verification — worse than not offering
    // the protocol at all, because the failure surfaces as an opaque `binding mismatch`.
    for (const opts of [undefined, {}, { mppSecret: '' }]) {
      const headers = buildChallengeHeaders(route, opts);
      expect(headers['PAYMENT-REQUIRED']).toBeTruthy();
      expect(headers['WWW-Authenticate']).toBeUndefined();
    }
  });

  it('the x402 PAYMENT-REQUIRED header decodes back to the input requirements', () => {
    const headers = buildChallengeHeaders(route, { mppSecret: 'secret' });
    const decoded = decodeRequirementsFromHeader(headers['PAYMENT-REQUIRED']);
    expect(decoded.protocol).toBe('x402');
    expect(decoded.scheme).toBe(route.scheme);
    expect(decoded.chain).toBe(route.chain);
    expect(decoded.network).toBe(route.network);
    expect(decoded.asset).toBe(route.asset);
    expect(decoded.amountAtomic).toBe(route.amountAtomic);
    expect(decoded.payTo).toBe(route.payTo);
    expect(decoded.resource).toBe(route.resource);
    expect(decoded.maxTimeoutSeconds).toBe(route.maxTimeoutSeconds);
  });

  it('the MPP challenge carries the bound charge-intent params', () => {
    const headers = buildChallengeHeaders(route, { mppSecret: 'secret' });
    const challenge = headers['WWW-Authenticate'];
    expect(challenge).toContain('intent="charge"');
    expect(challenge).toContain(`scheme="${route.scheme}"`);
    expect(challenge).toContain(`chain="${route.chain}"`);
    expect(challenge).toContain(`payTo="${route.payTo}"`);
    expect(challenge).toContain(`amount="${route.amountAtomic.toString()}"`);
    expect(challenge).toMatch(/binding="[0-9a-f]+"/);
  });
});

describe('extractPayment', () => {
  it('picks PAYMENT-SIGNATURE first', () => {
    const result = extractPayment({
      'PAYMENT-SIGNATURE': 'x402envelope',
      Authorization: 'Payment intent="charge"',
    });
    expect(result).toEqual({ protocol: 'x402', envelope: 'x402envelope' });
  });

  it('falls back to Authorization: Payment when PAYMENT-SIGNATURE absent', () => {
    const result = extractPayment({ Authorization: 'Payment intent="charge", foo="bar"' });
    expect(result).toEqual({ protocol: 'mpp', envelope: 'Payment intent="charge", foo="bar"' });
  });

  it('is case-insensitive on header names', () => {
    const result = extractPayment({ 'payment-signature': 'lowercase-envelope' });
    expect(result).toEqual({ protocol: 'x402', envelope: 'lowercase-envelope' });
  });

  it('ignores a non-Payment Authorization header', () => {
    const result = extractPayment({ Authorization: 'Bearer sometoken' });
    expect(result).toBeNull();
  });

  it('returns null when no payment header is present', () => {
    expect(extractPayment({})).toBeNull();
    expect(extractPayment({ 'content-type': 'application/json' })).toBeNull();
  });
});
