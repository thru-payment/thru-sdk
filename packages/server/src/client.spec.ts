import { ThruApiError, amountBoundsOf, createThruServerClient } from './client.js';
import type { CheckoutSession } from './types.js';

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('createThruServerClient', () => {
  it('refuses to be constructed without an API key', () => {
    expect(() => createThruServerClient({ apiKey: '' })).toThrow(/apiKey/);
  });

  it('authenticates with x-api-key, not a Bearer token', async () => {
    const { fn, calls } = stubFetch(() => ok({ id: 'cs_1' }));
    const thru = createThruServerClient({ apiKey: 'sk_test', fetch: fn });
    await thru.checkout.sessions.retrieve('cs_1');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk_test');
    expect(headers['authorization']).toBeUndefined();
  });

  it('posts a create to /checkout/sessions with the body verbatim', async () => {
    const { fn, calls } = stubFetch(() => ok({ id: 'cs_1', url: 'https://thru.la/c/cs_1' }));
    const thru = createThruServerClient({ apiKey: 'sk', fetch: fn });
    const session = await thru.checkout.sessions.create({
      productSlug: 'pro-monthly',
      reference: 'usr_01',
      metadata: { plan: 'pro' },
      successUrl: 'https://example.com/billing/success',
    });
    expect(calls[0]?.url).toBe('https://api.thru.la/v1/checkout/sessions');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      productSlug: 'pro-monthly',
      reference: 'usr_01',
      metadata: { plan: 'pro' },
    });
    expect(session.url).toBe('https://thru.la/c/cs_1');
  });

  it('builds the list query and drops undefined filters', async () => {
    const { fn, calls } = stubFetch(() => ok({ data: [], hasMore: false, nextCursor: null }));
    const thru = createThruServerClient({ apiKey: 'sk', fetch: fn });
    await thru.checkout.sessions.list({ reference: 'usr_01', status: 'completed', limit: 50 });
    const url = new URL(String(calls[0]?.url));
    expect(url.pathname).toBe('/v1/checkout/sessions');
    expect(url.searchParams.get('reference')).toBe('usr_01');
    expect(url.searchParams.get('status')).toBe('completed');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.has('cursor')).toBe(false);
  });

  it('encodes a session id into the path', async () => {
    const { fn, calls } = stubFetch(() => ok({ id: 'x' }));
    const thru = createThruServerClient({ apiKey: 'sk', fetch: fn });
    await thru.checkout.sessions.retrieve('cs_a/b?c');
    expect(calls[0]?.url).toContain('cs_a%2Fb%3Fc');
  });

  it('honours a custom base URL and strips a trailing slash', async () => {
    const { fn, calls } = stubFetch(() => ok({}));
    const thru = createThruServerClient({ apiKey: 'sk', baseUrl: 'http://localhost:3005/v1/', fetch: fn });
    await thru.checkout.sessions.retrieve('cs_1');
    expect(calls[0]?.url).toBe('http://localhost:3005/v1/checkout/sessions/cs_1');
  });

  it("surfaces the API's own message rather than a generic failure", async () => {
    const { fn } = stubFetch(
      () =>
        new Response(
          JSON.stringify({ message: 'successUrl: https://evil.test is not one of your registered return origins' }),
          { status: 400 },
        ),
    );
    const thru = createThruServerClient({ apiKey: 'sk', fetch: fn });
    await expect(
      thru.checkout.sessions.create({ productSlug: 'x', successUrl: 'https://evil.test' }),
    ).rejects.toThrow(/registered return origins/);
  });

  it('joins a class-validator message array', async () => {
    const { fn } = stubFetch(
      () => new Response(JSON.stringify({ message: ['a must be a string', 'b is required'] }), { status: 400 }),
    );
    const thru = createThruServerClient({ apiKey: 'sk', fetch: fn });
    await expect(thru.checkout.sessions.retrieve('x')).rejects.toThrow(/a must be a string; b is required/);
  });

  it('carries the status on the error, so a 404 can be told from a 500', async () => {
    const { fn } = stubFetch(() => new Response('', { status: 404 }));
    const thru = createThruServerClient({ apiKey: 'sk', fetch: fn });
    await expect(thru.checkout.sessions.retrieve('nope')).rejects.toMatchObject({
      name: 'ThruApiError',
      status: 404,
    });
    await expect(thru.checkout.sessions.retrieve('nope')).rejects.toBeInstanceOf(ThruApiError);
  });
});

describe('custom-amount sessions', () => {
  it('sends `amount` as the decimal string it was given, untouched', async () => {
    // The whole precision contract is "a string, never a number". The client must not parse,
    // round, or reformat — "37.50" goes over the wire as "37.50".
    const { fn, calls } = stubFetch(() =>
      ok({
        id: 'cs_1',
        url: 'https://thru.la/c/cs_1',
        amount: '37.50',
        currency: 'USD',
        expectedAmount: '37.50',
        receivedAmount: null,
      }),
    );
    const thru = createThruServerClient({ apiKey: 'sk', fetch: fn });
    const session = await thru.checkout.sessions.create({
      productSlug: 'credits',
      amount: '37.50',
      reference: 'order_9',
      idempotencyKey: 'order_9',
    });
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body.amount).toBe('37.50');
    expect(typeof body.amount).toBe('string');
    // The create response already carries the locked amount and its fallback into expectedAmount.
    expect(session.amount).toBe('37.50');
    expect(session.currency).toBe('USD');
    expect(session.expectedAmount).toBe('37.50');
    expect(session.receivedAmount).toBeNull();
  });

  it('does not invent an `amount` key on a fixed-price create', async () => {
    // A fixed-price product refuses `amount` with a 400. If the client ever serialised
    // `amount: undefined` as null or "", every existing integration would break on upgrade.
    const { fn, calls } = stubFetch(() => ok({ id: 'cs_1' }));
    const thru = createThruServerClient({ apiKey: 'sk', fetch: fn });
    await thru.checkout.sessions.create({ productSlug: 'pro-monthly' });
    expect(JSON.parse(String(calls[0]?.init?.body))).not.toHaveProperty('amount');
  });

  it('surfaces a 409 when an idempotency key is replayed with a different amount', async () => {
    const { fn } = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            statusCode: 409,
            message:
              'idempotencyKey "order_9" was already used for a different checkout (product p_1, amount 37). Retry with a new key to create a different session.',
          }),
          { status: 409 },
        ),
    );
    const thru = createThruServerClient({ apiKey: 'sk', fetch: fn });
    const attempt = thru.checkout.sessions.create({ productSlug: 'credits', amount: '38', idempotencyKey: 'order_9' });
    await expect(attempt).rejects.toMatchObject({ status: 409 });
    await expect(attempt).rejects.toThrow(/already used for a different checkout/);
    // Not a range failure, so there are no bounds to read off it.
    await attempt.catch((err) => expect(amountBoundsOf(err)).toBeNull());
  });

  it('carries `amount` and `currency` as null on a fixed-price session', async () => {
    const { fn } = stubFetch(() =>
      ok({ id: 'cs_1', amount: null, currency: null, expectedAmount: '9.99', receivedAmount: null }),
    );
    const thru = createThruServerClient({ apiKey: 'sk', fetch: fn });
    const session: CheckoutSession = await thru.checkout.sessions.retrieve('cs_1');
    expect(session.amount).toBeNull();
    expect(session.currency).toBeNull();
    expect(session.expectedAmount).toBe('9.99');
  });
});

describe('amountBoundsOf', () => {
  const rangeFailure = {
    statusCode: 400,
    error: 'Bad Request',
    message: 'amount 0.5 is below the minimum of 1 USD.',
    minAmount: '1',
    maxAmount: null,
    currency: 'USD',
  };

  it('reads the effective bounds off a range-failure 400', async () => {
    const { fn } = stubFetch(() => new Response(JSON.stringify(rangeFailure), { status: 400 }));
    const thru = createThruServerClient({ apiKey: 'sk', fetch: fn });
    let caught: unknown;
    try {
      await thru.checkout.sessions.create({ productSlug: 'credits', amount: '0.5' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ThruApiError);
    expect((caught as ThruApiError).message).toMatch(/below the minimum of 1 USD/);
    expect(amountBoundsOf(caught)).toEqual({ minAmount: '1', maxAmount: null, currency: 'USD' });
  });

  it('keeps a string maxAmount when the product has a ceiling', () => {
    const err = new ThruApiError(400, 'amount 501 is above the maximum of 500 USD.', {
      ...rangeFailure,
      message: 'amount 501 is above the maximum of 500 USD.',
      maxAmount: '500',
    });
    expect(amountBoundsOf(err)).toEqual({ minAmount: '1', maxAmount: '500', currency: 'USD' });
  });

  it('returns null for a malformed-amount 400, which carries no bounds', () => {
    const err = new ThruApiError(400, 'amount must be a decimal string…', {
      statusCode: 400,
      message: 'amount must be a decimal string with at most 2 decimal places, e.g. "37" or "37.50".',
      error: 'Bad Request',
    });
    expect(amountBoundsOf(err)).toBeNull();
  });

  it('returns null for anything that is not a thru 400', () => {
    expect(amountBoundsOf(new Error('network down'))).toBeNull();
    expect(amountBoundsOf(new ThruApiError(500, 'boom', rangeFailure))).toBeNull();
    expect(amountBoundsOf(new ThruApiError(400, 'x', 'not json'))).toBeNull();
    expect(amountBoundsOf(new ThruApiError(400, 'x', { ...rangeFailure, currency: 'EUR' }))).toBeNull();
    expect(amountBoundsOf(new ThruApiError(400, 'x', { ...rangeFailure, minAmount: 1 }))).toBeNull();
    expect(amountBoundsOf(undefined)).toBeNull();
  });
});

describe('payments', () => {
  it('reads a payment by id and exposes its bound session', async () => {
    const { fn, calls } = stubFetch(() =>
      ok({
        id: 'pay_1',
        status: 'underpaid',
        token: 'USDC',
        expectedAmount: '37',
        receivedAmount: '20',
        checkoutSession: { id: 'cs_1', reference: 'order_9', metadata: { userId: 'u_1' } },
      }),
    );
    const thru = createThruServerClient({ apiKey: 'sk', fetch: fn });
    const payment = await thru.payments.retrieve('pay_1');
    expect(calls[0]?.url).toBe('https://api.thru.la/v1/payments/pay_1');
    expect(calls[0]?.init?.method).toBeUndefined();
    expect(payment.receivedAmount).toBe('20');
    expect(payment.checkoutSession?.reference).toBe('order_9');
  });

  it('encodes the payment id into the path', async () => {
    const { fn, calls } = stubFetch(() => ok({ id: 'x', checkoutSession: null }));
    const thru = createThruServerClient({ apiKey: 'sk', fetch: fn });
    const payment = await thru.payments.retrieve('pay/1?x');
    expect(calls[0]?.url).toContain('/payments/pay%2F1%3Fx');
    expect(payment.checkoutSession).toBeNull();
  });
});
