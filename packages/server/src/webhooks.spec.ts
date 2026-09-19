import { hmacHex } from './hmac.js';
import {
  ThruSignatureError,
  constructThruEvent,
  isCheckoutSessionEvent,
  isPaymentEvent,
} from './webhooks.js';

// These mirror what apps/api/src/webhooks/webhook-delivery.service.ts actually sends:
// `x-thru-signature: sha256=<hex>` over the raw JSON body, keyed by the endpoint's secret.

const SECRET = 'whsec_test';
const BODY = JSON.stringify({
  id: '0f4c2b19-7a3d-4e58-9c01-83b6ea2d4177',
  type: 'checkout.session.completed',
  createdAt: '2026-09-16T12:04:11.482Z',
  data: { sessionId: 'cs_abc', reference: 'usr_01', status: 'completed', late: false },
});

async function signedHeaders(body = BODY, secret = SECRET) {
  return new Headers({
    'x-thru-event': 'checkout.session.completed',
    'x-thru-signature': `sha256=${await hmacHex(secret, body)}`,
  });
}

describe('constructThruEvent', () => {
  it('returns the parsed event when the signature matches', async () => {
    const event = await constructThruEvent(BODY, await signedHeaders(), SECRET);
    expect(event.type).toBe('checkout.session.completed');
    expect(event.id).toBe('0f4c2b19-7a3d-4e58-9c01-83b6ea2d4177');
  });

  it('throws rather than returning a boolean nobody checks', async () => {
    // A `verify(): boolean` API is one forgotten `if` away from trusting an unsigned body. This
    // one cannot be used without handling the failure.
    const headers = new Headers({ 'x-thru-signature': `sha256=${'0'.repeat(64)}` });
    await expect(constructThruEvent(BODY, headers, SECRET)).rejects.toBeInstanceOf(
      ThruSignatureError,
    );
  });

  it('rejects a body that was re-serialised after parsing', async () => {
    // The commonest integration bug: `await req.json()` then `JSON.stringify(...)`. Key order and
    // whitespace change, so the bytes are no longer the ones that were signed.
    const reserialised = JSON.stringify(JSON.parse(BODY), Object.keys(JSON.parse(BODY)).reverse());
    await expect(
      constructThruEvent(reserialised, await signedHeaders(), SECRET),
    ).rejects.toMatchObject({ reason: 'bad_signature' });
  });

  it('rejects a missing header', async () => {
    await expect(constructThruEvent(BODY, new Headers(), SECRET)).rejects.toMatchObject({
      reason: 'missing_signature',
    });
  });

  it('rejects a bare hex digest with no algorithm prefix', async () => {
    // Accepting one would mean accepting a future algorithm's signature as if it were sha256.
    const headers = new Headers({ 'x-thru-signature': await hmacHex(SECRET, BODY) });
    await expect(constructThruEvent(BODY, headers, SECRET)).rejects.toMatchObject({
      reason: 'bad_format',
    });
  });

  it('rejects a signature of the wrong length or case', async () => {
    for (const value of ['sha256=abc', `sha256=${'A'.repeat(64)}`, 'sha512=' + '0'.repeat(64)]) {
      const headers = new Headers({ 'x-thru-signature': value });
      await expect(constructThruEvent(BODY, headers, SECRET)).rejects.toMatchObject({
        reason: 'bad_format',
      });
    }
  });

  it('rejects the wrong secret', async () => {
    await expect(
      constructThruEvent(BODY, await signedHeaders(BODY, 'other'), SECRET),
    ).rejects.toMatchObject({ reason: 'bad_signature' });
  });

  it('rejects a correctly signed body that is not JSON', async () => {
    const body = 'not json';
    await expect(
      constructThruEvent(body, await signedHeaders(body), SECRET),
    ).rejects.toMatchObject({ reason: 'bad_payload' });
  });

  it('rejects correctly signed JSON that is not an event', async () => {
    const body = JSON.stringify({ hello: 'world' });
    await expect(
      constructThruEvent(body, await signedHeaders(body), SECRET),
    ).rejects.toMatchObject({ reason: 'bad_payload' });
  });

  it('reads headers from a plain object as well as a Headers instance', async () => {
    const headers = { 'x-thru-signature': `sha256=${await hmacHex(SECRET, BODY)}` };
    expect((await constructThruEvent(BODY, headers, SECRET)).type).toBe(
      'checkout.session.completed',
    );
  });

  it("reads Node's array-valued headers", async () => {
    const headers = { 'x-thru-signature': [`sha256=${await hmacHex(SECRET, BODY)}`] };
    expect((await constructThruEvent(BODY, headers, SECRET)).type).toBe(
      'checkout.session.completed',
    );
  });
});

describe('isCheckoutSessionEvent', () => {
  it('narrows the four session events', async () => {
    const event = await constructThruEvent(BODY, await signedHeaders(), SECRET);
    expect(isCheckoutSessionEvent(event)).toBe(true);
    if (isCheckoutSessionEvent(event)) {
      // The point of the guard: `reference` is reachable without a cast.
      expect(event.data.reference).toBe('usr_01');
    }
  });

  it('does not claim a payment event', async () => {
    const body = JSON.stringify({ id: 'e1', type: 'payment.confirmed', createdAt: '', data: {} });
    const event = await constructThruEvent(body, await signedHeaders(body), SECRET);
    expect(isCheckoutSessionEvent(event)).toBe(false);
  });

  it('carries the locked amount of a custom-amount session', async () => {
    const body = JSON.stringify({
      id: 'e2',
      type: 'checkout.session.completed',
      createdAt: '',
      data: {
        sessionId: 'cs_37',
        reference: 'order_9',
        status: 'completed',
        amount: '37',
        currency: 'USD',
        token: 'USDC',
        expectedAmount: '37',
        receivedAmount: '37',
        late: false,
      },
    });
    const event = await constructThruEvent(body, await signedHeaders(body), SECRET);
    if (!isCheckoutSessionEvent(event)) throw new Error('expected a session event');
    expect(event.data.amount).toBe('37');
    expect(event.data.currency).toBe('USD');
    expect(event.data.receivedAmount).toBe('37');
  });
});

describe('isPaymentEvent', () => {
  // Mirrors apps/api/src/webhooks/webhook-events.service.ts: `payment.confirmed|underpaid|
  // overpaid|refunded` are `{ merchantId, eventType, payment, blockchainTransaction }` plus
  // `checkoutSession` when bound; `payment.expired` is the older flat body.
  const moneyEvent = (type: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      id: `evt_${type}`,
      type,
      createdAt: '2026-09-19T10:00:00.000Z',
      data: {
        merchantId: 'm_1',
        eventType: type,
        payment: {
          id: 'pay_1',
          chain: 'base',
          network: 'mainnet',
          token: 'USDC',
          amount: '37',
          currency: 'USDC',
          expectedAmount: '37',
          receivedAmount: '20',
          feeBps: 100,
          feeAmount: '0.2',
          status: 'underpaid',
          metadata: { thru: { sessionId: 'cs_37', reference: 'order_9' } },
        },
        blockchainTransaction: { txHash: '0xabc', amount: '20', blockNumber: '12345678' },
        ...extra,
      },
    });

  it('narrows the five payment events and none of the others', async () => {
    for (const type of ['payment.confirmed', 'payment.underpaid', 'payment.overpaid', 'payment.refunded']) {
      const body = moneyEvent(type);
      const event = await constructThruEvent(body, await signedHeaders(body), SECRET);
      expect(isPaymentEvent(event)).toBe(true);
      expect(isCheckoutSessionEvent(event)).toBe(false);
    }
    for (const type of ['checkout.session.completed', 'settlement.completed', 'facilitator.payment.settled']) {
      const body = JSON.stringify({ id: 'e', type, createdAt: '', data: {} });
      const event = await constructThruEvent(body, await signedHeaders(body), SECRET);
      expect(isPaymentEvent(event)).toBe(false);
    }
  });

  it('exposes `checkoutSession` on a session-bound payment, typed', async () => {
    const body = moneyEvent('payment.underpaid', {
      checkoutSession: { id: 'cs_37', reference: 'order_9', metadata: { userId: 'u_1' } },
    });
    const event = await constructThruEvent(body, await signedHeaders(body), SECRET);
    if (!isPaymentEvent(event)) throw new Error('expected a payment event');
    if (event.type === 'payment.expired') throw new Error('not an expiry');
    // The point of the guard: the crediting handler reaches the merchant's own reference and the
    // cumulative receivedAmount without a cast.
    expect(event.data.checkoutSession?.reference).toBe('order_9');
    expect(event.data.checkoutSession?.id).toBe('cs_37');
    expect(event.data.payment.receivedAmount).toBe('20');
    expect(event.data.payment.expectedAmount).toBe('37');
    expect(event.data.blockchainTransaction?.txHash).toBe('0xabc');
  });

  it('leaves `checkoutSession` ABSENT, not null, on an unbound payment', async () => {
    // The API adds the key only when there is a session, so a receiver written before sessions
    // existed sees the exact shape it always did. A handler must test presence, not null.
    const body = moneyEvent('payment.confirmed');
    const event = await constructThruEvent(body, await signedHeaders(body), SECRET);
    if (!isPaymentEvent(event) || event.type === 'payment.expired') throw new Error('unexpected');
    expect('checkoutSession' in event.data).toBe(false);
    expect(event.data.checkoutSession).toBeUndefined();
  });

  it('types the flat payment.expired body, with checkoutSession when a rail switch retired it', async () => {
    const body = JSON.stringify({
      id: 'evt_exp',
      type: 'payment.expired',
      createdAt: '',
      data: {
        paymentId: 'pay_old',
        chain: 'base',
        network: 'mainnet',
        token: 'USDC',
        expectedAmount: '37',
        expiresAt: '2026-09-19T10:30:00.000Z',
        checkoutSession: { id: 'cs_37', reference: 'order_9', metadata: null },
      },
    });
    const event = await constructThruEvent(body, await signedHeaders(body), SECRET);
    if (!isPaymentEvent(event)) throw new Error('expected a payment event');
    if (event.type !== 'payment.expired') throw new Error('expected an expiry');
    expect(event.data.paymentId).toBe('pay_old');
    expect(event.data.expectedAmount).toBe('37');
    expect(event.data.checkoutSession?.id).toBe('cs_37');
  });
});
