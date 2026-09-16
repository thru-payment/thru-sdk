import { ThruApiError, createThruServerClient } from './client.js';

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
      productSlug: 'sup-pro-monthly',
      reference: 'sup_usr_01',
      metadata: { plan: 'pro' },
      successUrl: 'https://www.supwallet.app/billing/success',
    });
    expect(calls[0]?.url).toBe('https://api.thru.la/v1/checkout/sessions');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      productSlug: 'sup-pro-monthly',
      reference: 'sup_usr_01',
      metadata: { plan: 'pro' },
    });
    expect(session.url).toBe('https://thru.la/c/cs_1');
  });

  it('builds the list query and drops undefined filters', async () => {
    const { fn, calls } = stubFetch(() => ok({ data: [], hasMore: false, nextCursor: null }));
    const thru = createThruServerClient({ apiKey: 'sk', fetch: fn });
    await thru.checkout.sessions.list({ reference: 'sup_usr_01', status: 'completed', limit: 50 });
    const url = new URL(String(calls[0]?.url));
    expect(url.pathname).toBe('/v1/checkout/sessions');
    expect(url.searchParams.get('reference')).toBe('sup_usr_01');
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
