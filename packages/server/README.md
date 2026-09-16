# @thru-payment/server

The server side of [thru](https://thru.la): create a hosted checkout, send a customer to it, and
find out how it went.

```bash
npm i @thru-payment/server
```

Web Crypto only — no `node:crypto`, no `Buffer`. Runs unchanged on Node 20+, Cloudflare Workers,
Deno and Bun. There is no browser build, on purpose: this package holds your API key.

---

## The problem it solves

A customer clicks a plan on your site, pays on thru's page, and comes back. Three questions have to
be answerable:

1. **Who was that?** thru does not know your users. A checkout session carries a `reference` you
   set — your user id, your order number — through the payment and back out in the webhook.
2. **Did it work?** The browser is not a reliable messenger. A shopper can close the tab, lose
   signal, or return before the chain has confirmed.
3. **What if they never come back?** The webhook is the answer, and a list endpoint is the answer
   to the webhook also failing.

---

## 1. Create a session

```ts
import { createThruServerClient } from '@thru-payment/server';

const thru = createThruServerClient({ apiKey: process.env.THRU_API_KEY! });

const session = await thru.checkout.sessions.create({
  productSlug: 'sup-pro-monthly',
  reference: user.id,                       // YOUR identifier. Never shown to the shopper.
  metadata: { plan: 'pro', creditsPerWeek: 400 },
  idempotencyKey: `sub:pro:${user.id}:${Math.floor(Date.now() / 3_600_000)}`,

  successUrl: 'https://www.supwallet.app/billing/success',
  cancelUrl:  'https://www.supwallet.app/billing/cancelled',
  expiredUrl: 'https://www.supwallet.app/billing/expired',
  pendingUrl: 'https://www.supwallet.app/billing/pending',
});

return Response.redirect(session.url, 303);  // https://thru.la/c/cs_...
```

Every URL must be on your **return origins** allow-list (Console → Developers → Checkout). thru
refuses to redirect a shopper anywhere else, which is what stops thru.la being used as an open
redirector. Omit them all and the session inherits whatever the product already had.

`idempotencyKey` makes the call safe to retry: the same key returns the same session, never a
second one.

## 2. Handle the return

```ts
import { verifyThruReturn } from '@thru-payment/server/checkout';

export default async function Success({ searchParams }) {
  const ret = await verifyThruReturn(await searchParams, process.env.THRU_CHECKOUT_SECRET!);
  if (!ret.verified) return <BillingError />;

  // Render on the signature. GRANT on the retrieve.
  const session = await thru.checkout.sessions.retrieve(ret.sessionId);
  if (session.status === 'completed') {
    await grantEntitlement({
      userId: session.reference!,            // came back over an authenticated channel
      plan: String(session.metadata?.plan),
      idempotencyKey: session.id,            // the same key the webhook will use
    });
    return <PlanActive />;
  }
  return <BillingPending status={session.status} />;
}
```

### Why two steps

A verified return proves *thru observed this session in this status at this second*. That is enough
to render — no spinner racing a webhook. It is **not** enough to grant: settlement is asynchronous,
so a shopper handed `pending` can still underpay, and a `completed` page can be reopened from
browser history a week later. Neither is forgery; both are staleness, and no signature fixes
staleness.

`verifyThruReturn` enforces the split by its return type. A verified result carries
`{ verified, sessionId, status }` and nothing else — no amount, no reference, no plan. There is
nothing on it to grant from.

### The outcomes

`thru_status` is one of `completed`, `pending`, `cancelled`, `expired`, `failed`, and each routes to
its own URL (falling back to `returnUrl`, then to the product's own). **`pending` is the one that
matters and the one card rails do not have**: the customer has paid, the chain has not confirmed,
and they want to leave. Send them to a page that says so; the entitlement follows from the webhook.

## 3. Handle the webhook

This is what covers the customer who never came back. thru writes the event in the same database
transaction that records the money, so "they paid" and "you will be told" commit together.

```ts
import { constructThruEvent, isCheckoutSessionEvent } from '@thru-payment/server/webhooks';

export async function POST(request: Request) {
  const raw = await request.text();            // RAW bytes. Never await request.json().

  let event;
  try {
    event = await constructThruEvent(raw, request.headers, process.env.THRU_WEBHOOK_SECRET!);
  } catch {
    return new Response('bad signature', { status: 400 });   // 4xx: thru stops retrying
  }

  if (await alreadyHandled(event.id)) return Response.json({ ok: true });

  if (isCheckoutSessionEvent(event) && event.type === 'checkout.session.completed') {
    const { reference, metadata, network, late } = event.data;
    if (network !== 'mainnet') return Response.json({ ok: true, ignored: 'testnet' });
    if (!reference) return new Response('no reference', { status: 422 });

    await grantEntitlement({ userId: reference, plan: String(metadata?.plan), idempotencyKey: event.data.sessionId });
    if (late) await alertOps(event.data.sessionId);   // we already told this user no
  }

  return Response.json({ ok: true });
}
```

Two rules that decide whether a paying customer gets what they bought:

- **Read the raw body.** The signature covers the exact bytes thru sent. Re-serialising a parsed
  object changes key order and whitespace, and the signature will not match.
- **Answer 4xx/5xx when you could not handle it.** A `200` means "recorded" and thru stops
  retrying. Returning `200` for an event you could not map — unknown plan, database down — is
  exactly how a paid customer silently never gets their entitlement. Return `422` and let the retry
  schedule work.

`checkout.session.completed`, `.expired`, `.cancelled` and `.failed` all carry an **identical
payload**, and so do a one-off product, a subscription product and an invoice — irrelevant fields
are `null`. One handler covers every case.

Fields worth knowing about:

| field | why |
|---|---|
| `reference`, `metadata` | yours, verbatim, top level |
| `network` | gate on this if your entitlement is mainnet-only |
| `tokenAddress`, `decimals`, `expectedAmountAtomic` | exact reconciliation; a symbol like `USDC` collides across chains |
| `late` | money arrived after you were told the session was dead — grant, *and* alert |
| `txHash` | the on-chain receipt |

## 4. The layer underneath

If the browser never returned **and** every webhook attempt failed, this still finds the sale:

```ts
const { data, nextCursor } = await thru.checkout.sessions.list({
  status: 'completed',
  createdAfter: watermark,     // ISO-8601, stored by you
});
```

Keyset pagination on a monotonic cursor, so walking forward from a watermark cannot skip a row.
Run it on a cron. You can also answer support directly:

```ts
await thru.checkout.sessions.list({ reference: user.id });
```

---

## API

| export | |
|---|---|
| `createThruServerClient({ apiKey, baseUrl?, fetch? })` | the client |
| `thru.checkout.sessions.create / retrieve / list / expire` | sessions |
| `verifyThruReturn(params, secret, { toleranceSeconds?, now? })` | the return page |
| `constructThruEvent(rawBody, headers, secret)` | webhooks — throws on failure |
| `isCheckoutSessionEvent(event)` | narrows to the session family |
| `hmacHex`, `safeEqualHex` | the primitives, if you need them |
| `ThruApiError`, `ThruSignatureError` | typed failures |

`verifyThruReturn` accepts a `URLSearchParams`, a `URL`, a full URL string, a bare query string, or
Next.js' `searchParams` object.

## Secrets

| variable | where |
|---|---|
| `THRU_API_KEY` | Console → Developers → API keys |
| `THRU_CHECKOUT_SECRET` | Console → Developers → Checkout |
| `THRU_WEBHOOK_SECRET` | per endpoint, Console → Developers → Webhooks |

The checkout secret and the webhook secret are separate deliberately: you may have no webhook
endpoints and still need to verify a return, and having several endpoints must not mean several
valid return signatures.

## Related

- [`@thru-payment/checkout-core`](../checkout-core) — headless client and stores for your own UI
- [`@thru-payment/pay-sdk`](../pay-sdk) — React checkout components
- [`@thru-payment/x402`](../x402) — HTTP 402 / agent payments

MIT
