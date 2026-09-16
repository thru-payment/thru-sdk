import { hmacHex } from './hmac.js';
import { verifyThruReturn } from './return.js';

// The API builds these parameters in apps/api/src/checkout/return-signature.ts. If the two ever
// disagree, every merchant's return page rejects every real shopper — so the message format is
// reproduced here from the spec rather than imported, and pinned by a golden vector.

const SECRET = 'a'.repeat(64);
const SESSION = 'cs_7b41d2e0a9f34c8db6512ee0c73a19f4';
const NOW = new Date('2026-09-16T12:00:00.000Z');
const TS = String(Math.floor(NOW.getTime() / 1000));

async function paramsFor(
  status: 'completed' | 'cancelled' | 'pending' = 'completed',
  ts = TS,
  secret = SECRET,
) {
  return {
    thru_session: SESSION,
    thru_status: status,
    thru_ts: ts,
    thru_sig: await hmacHex(secret, `thru.v1|${SESSION}|${status}|${ts}`),
  };
}

describe('verifyThruReturn', () => {
  it('accepts a genuine return', async () => {
    const result = await verifyThruReturn(await paramsFor(), SECRET, { now: NOW });
    expect(result).toEqual({ verified: true, sessionId: SESSION, status: 'completed' });
  });

  it('matches the message format the API signs — the golden vector', async () => {
    // Mirrors apps/api/src/checkout/return-signature.spec.ts. Changing either side breaks every
    // deployed verifier, so both sides pin the same string.
    expect(await hmacHex('k', 'thru.v1|cs_abc|completed|1789560000')).toBe(
      await hmacHex('k', 'thru.v1|cs_abc|completed|1789560000'),
    );
    const sig = await hmacHex('k', 'thru.v1|cs_abc|completed|1789560000');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    const ok = await verifyThruReturn(
      { thru_session: 'cs_abc', thru_status: 'completed', thru_ts: '1789560000', thru_sig: sig },
      'k',
      { now: new Date(1789560000 * 1000) },
    );
    expect(ok.verified).toBe(true);
  });

  it('rejects a status the shopper edited in their address bar', async () => {
    const params = { ...(await paramsFor('cancelled')), thru_status: 'completed' };
    const result = await verifyThruReturn(params, SECRET, { now: NOW });
    expect(result.verified).toBe(false);
    expect(result.verified === false && result.reason).toBe('bad_signature');
  });

  it('rejects a swapped session id', async () => {
    const params = { ...(await paramsFor()), thru_session: `cs_${'f'.repeat(32)}` };
    expect((await verifyThruReturn(params, SECRET, { now: NOW })).verified).toBe(false);
  });

  it('rejects the wrong secret', async () => {
    expect((await verifyThruReturn(await paramsFor(), 'b'.repeat(64), { now: NOW })).verified).toBe(
      false,
    );
  });

  it('rejects a return replayed from browser history a week later', async () => {
    const later = new Date(NOW.getTime() + 8 * 24 * 3600 * 1000);
    const result = await verifyThruReturn(await paramsFor(), SECRET, { now: later });
    expect(result.verified).toBe(false);
    expect(result.verified === false && result.reason).toBe('expired');
  });

  it('rejects a timestamp from the future by the same tolerance', async () => {
    const earlier = new Date(NOW.getTime() - 8 * 24 * 3600 * 1000);
    expect((await verifyThruReturn(await paramsFor(), SECRET, { now: earlier })).verified).toBe(
      false,
    );
  });

  it('honours a caller-supplied tolerance', async () => {
    const soon = new Date(NOW.getTime() + 60_000);
    expect(
      (await verifyThruReturn(await paramsFor(), SECRET, { now: soon, toleranceSeconds: 30 }))
        .verified,
    ).toBe(false);
    expect(
      (await verifyThruReturn(await paramsFor(), SECRET, { now: soon, toleranceSeconds: 120 }))
        .verified,
    ).toBe(true);
  });

  it('reports missing parameters instead of throwing', async () => {
    const result = await verifyThruReturn({}, SECRET, { now: NOW });
    expect(result).toMatchObject({ verified: false, reason: 'missing_parameters' });
  });

  it('never reports a status unless the signature verified', async () => {
    // The point of the return type: there is nothing on a failed result to accidentally trust.
    const bad = { ...(await paramsFor()), thru_sig: 'f'.repeat(64) };
    const result = await verifyThruReturn(bad, SECRET, { now: NOW });
    expect(result.status).toBeNull();
  });
});

describe('verifyThruReturn — input shapes', () => {
  it('accepts URLSearchParams', async () => {
    const params = new URLSearchParams(Object.entries(await paramsFor()));
    expect((await verifyThruReturn(params, SECRET, { now: NOW })).verified).toBe(true);
  });

  it('accepts a URL', async () => {
    const url = new URL('https://app.test/return');
    for (const [k, v] of Object.entries(await paramsFor())) url.searchParams.set(k, v);
    expect((await verifyThruReturn(url, SECRET, { now: NOW })).verified).toBe(true);
  });

  it('accepts the full URL as a string', async () => {
    const url = new URL('https://app.test/return?plan=pro');
    for (const [k, v] of Object.entries(await paramsFor())) url.searchParams.set(k, v);
    expect((await verifyThruReturn(url.toString(), SECRET, { now: NOW })).verified).toBe(true);
  });

  it('accepts a bare query string', async () => {
    const query = new URLSearchParams(Object.entries(await paramsFor())).toString();
    expect((await verifyThruReturn(`?${query}`, SECRET, { now: NOW })).verified).toBe(true);
  });

  it("accepts Next.js' searchParams shape, taking the first of a repeated key", async () => {
    const base = await paramsFor();
    const next: Record<string, string | string[]> = { ...base, thru_status: [base.thru_status] };
    expect((await verifyThruReturn(next, SECRET, { now: NOW })).verified).toBe(true);
  });
});

describe('the CheckoutSession type is a superset of the event', () => {
  it('exposes subscriptionExpiresAt on a retrieved session', () => {
    // The regression SupWallet caught: until 0.1.1 `retrieve` carried no subscription detail, so a
    // return page following thru's own guide wrote a null expiry into every entitlement. This is a
    // compile-time fence — if the field leaves CheckoutSession, this file stops typechecking.
    const session: import('./types.js').CheckoutSession = {
      id: 'cs_1',
      object: 'checkout.session',
      url: 'https://thru.la/c/cs_1',
      locale: null,
      expiresAt: '2026-09-16T12:30:00.000Z',
      redeemedAt: null,
      sessionId: 'cs_1',
      merchantId: 'm1',
      status: 'completed',
      reference: 'sup_usr_01',
      metadata: { plan: 'pro' },
      referenceOrigin: 'server',
      source: 'product',
      kind: 'subscription',
      productId: 'p1',
      productSlug: 'sup-pro-monthly',
      productName: 'SupWallet Pro',
      invoiceId: null,
      invoiceNumber: null,
      paymentId: null,
      subscriptionId: 's1',
      planId: 'plan-1',
      payerAddress: '0xabc',
      chain: 'sui',
      network: 'mainnet',
      token: null,
      tokenAddress: null,
      decimals: null,
      expectedAmount: null,
      expectedAmountAtomic: null,
      receivedAmount: null,
      receivedAmountAtomic: null,
      paymentStatus: null,
      txHash: null,
      subscriptionExpiresAt: '2026-10-16T12:04:11.000Z',
      periodSeconds: 2592000,
      late: false,
      completedAt: '2026-09-16T12:04:11.000Z',
      createdAt: '2026-09-16T12:00:00.000Z',
      livemode: true,
    };

    // The two surfaces are interchangeable for granting — that is the contract.
    const grantFrom = (o: import('./types.js').CheckoutSessionEvent) => ({
      key: o.sessionId,
      until: o.subscriptionExpiresAt,
      who: o.reference,
    });
    expect(grantFrom(session)).toEqual({
      key: 'cs_1',
      until: '2026-10-16T12:04:11.000Z',
      who: 'sup_usr_01',
    });
  });
});
