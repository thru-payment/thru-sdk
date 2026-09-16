import { hmacHex } from './hmac.js';
import { ThruSignatureError, constructThruEvent, isCheckoutSessionEvent } from './webhooks.js';

// These mirror what apps/api/src/webhooks/webhook-delivery.service.ts actually sends:
// `x-thru-signature: sha256=<hex>` over the raw JSON body, keyed by the endpoint's secret.

const SECRET = 'whsec_test';
const BODY = JSON.stringify({
  id: '0f4c2b19-7a3d-4e58-9c01-83b6ea2d4177',
  type: 'checkout.session.completed',
  createdAt: '2026-09-16T12:04:11.482Z',
  data: { sessionId: 'cs_abc', reference: 'sup_usr_01', status: 'completed', late: false },
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
      expect(event.data.reference).toBe('sup_usr_01');
    }
  });

  it('does not claim a payment event', async () => {
    const body = JSON.stringify({ id: 'e1', type: 'payment.confirmed', createdAt: '', data: {} });
    const event = await constructThruEvent(body, await signedHeaders(body), SECRET);
    expect(isCheckoutSessionEvent(event)).toBe(false);
  });
});
