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
  productSlug: 'pro-monthly',
  reference: user.id,                       // YOUR identifier. Never shown to the shopper.
  metadata: { plan: 'pro', creditsPerWeek: 400 },
  idempotencyKey: `sub:pro:${user.id}:${Math.floor(Date.now() / 3_600_000)}`,

  successUrl: 'https://example.com/billing/success',
  cancelUrl:  'https://example.com/billing/cancelled',
  expiredUrl: 'https://example.com/billing/expired',
  pendingUrl: 'https://example.com/billing/pending',
});

return Response.redirect(session.url, 303);  // https://thru.la/c/cs_...
```

Every URL must be on your **return origins** allow-list (Console → Developers → Checkout). thru
refuses to redirect a shopper anywhere else, which is what stops thru.la being used as an open
redirector. Omit them all and the session inherits whatever the product already had.

`idempotencyKey` makes the call safe to retry: the same key returns the same session, never a
second one.

### A custom amount

A product can be priced by the shopper instead of the catalogue — a balance top-up, a bundle of
credits. Create it with `pricingMode: 'custom_amount'` (and an optional `minAmount`/`maxAmount`)
in the console or the products API, then name the amount on every session:

```ts
const session = await thru.checkout.sessions.create({
  productSlug: 'credits',
  amount: '37',                             // a decimal STRING, in USD. "37", "37.5", "37.50".
  reference: order.id,
  idempotencyKey: order.id,                 // same key + same amount → same session
});
session.amount;          // "37"    what you locked
session.expectedAmount;  // "37"    what the payment will expect, in the stablecoin the shopper picks
session.receivedAmount;  // null    what has arrived — the number you credit from, later
```

The rules, all enforced by thru:

- **Precision.** At most two decimal places, never below `0.01`, no sign or exponent. Send a
  string; the SDK never parses or rounds it.
- **Locked.** The shopper's page has no amount field and the redeem endpoint rejects one. Nothing
  can change the amount once the session exists.
- **Bounded.** An amount outside the product's range is a `400` whose body carries the effective
  bounds, so your form can show the real minimum *before* anyone transfers:

  ```ts
  import { amountBoundsOf } from '@thru-payment/server';

  try {
    session = await thru.checkout.sessions.create({ productSlug: 'credits', amount, reference });
  } catch (err) {
    const bounds = amountBoundsOf(err);     // { minAmount: "1", maxAmount: null, currency: "USD" } | null
    if (bounds) return fail(422, `minimum top-up is ${bounds.minAmount} ${bounds.currency}`);
    throw err;
  }
  ```

- **Required there, refused elsewhere.** A custom-amount product without `amount` is a `400`; a
  fixed-price product or an invoice *with* one is a `400` too.
- **Idempotent on (source, amount).** Replaying a key with a different product or amount is a
  `409`, never the old session handed back as if it matched.

The public product (`GET /v1/public/products/:slug`) exposes `pricingMode`, `minAmount` (already
the effective one) and `maxAmount`, if you want to render the bounds without a round-trip.

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
  retrying. Returning `200` for an event you could not map — unknown product, database down — is
  exactly how a paid customer silently never gets their entitlement. Return `422` and let the retry
  schedule work.

`checkout.session.completed`, `.expired`, `.cancelled` and `.failed` all carry an **identical
payload**, and so do a product and an invoice — irrelevant fields are `null`. One handler covers
every case.

Fields worth knowing about:

| field | why |
|---|---|
| `reference`, `metadata` | yours, verbatim, top level |
| `network` | gate on this if your entitlement is mainnet-only |
| `amount`, `currency` | what you locked on a custom-amount session, in USD; both `null` otherwise |
| `expectedAmount`, `receivedAmount` | what the payment asks for, and what has arrived |
| `tokenAddress`, `decimals`, `expectedAmountAtomic` | exact reconciliation; a symbol like `USDC` collides across chains |
| `late` | money arrived after you were told the session was dead — grant, *and* alert |
| `txHash` | the on-chain receipt |

### Crediting an amount: listen to `payment.*` instead

A plan is granted because it was paid for; a top-up is credited by *how much arrived*. For the
second question `checkout.session.*` is the wrong family — it reports the session's outcome once,
while `payment.*` fires on every transition of the money: `underpaid` when a short transfer lands,
`confirmed` (or `overpaid`) when a later top-up completes it. Subscribe to **one** family, not
both, or you will credit twice.

Every `payment.*` event now carries `checkoutSession: { id, reference, metadata }` when the payment
belongs to a session, so you still know whose money it is. The key is **absent** — not `null` —
on a payment that was never part of a session.

```ts
import { constructThruEvent, isPaymentEvent } from '@thru-payment/server/webhooks';

const event = await constructThruEvent(raw, request.headers, process.env.THRU_WEBHOOK_SECRET!);

if (isPaymentEvent(event) && event.type !== 'payment.expired') {
  const orderId = event.data.checkoutSession?.reference;
  if (!orderId) return Response.json({ ok: true, ignored: 'not one of ours' });

  // The event says the money moved. The read says how much is there NOW — a top-up can have
  // landed in between. Credit the DIFFERENCE between receivedAmount and what you already granted.
  const payment = await thru.payments.retrieve(event.data.payment.id);
  if (payment.network !== 'mainnet') return Response.json({ ok: true, ignored: 'testnet' });
  await creditUpTo({ orderId, receivedAmount: payment.receivedAmount, token: payment.token });
}
```

The amounts on a payment, and which one to read:

| field | |
|---|---|
| `expectedAmount` | what was asked — the session's `amount`, or the rail's price |
| `receivedAmount` | what has **arrived**, cumulative across every transfer to the address. Credit from this. |
| `token`, `currency` | the stablecoin the shopper paid in; the amounts are in it |
| `feeBps`, `feeAmount` | thru's platform fee on the row |
| `status` | `underpaid` until `receivedAmount` reaches `expectedAmount`; then `confirmed` or `overpaid` |

No threshold hides a small receipt: any detected transfer is added to `receivedAmount` and
reported. `payment.expired` is a display state, not a close — a transfer that lands during the
late grace is still credited, and the session event that follows says `late: true`.

**One session, one payment that ever received money.** A shopper who was not pinned to a chain can
switch rail before sending anything; thru retires the previous payment (`payment.expired`, with
`checkoutSession`) and binds a new one. Once any money has arrived the rail is fixed. If money
lands on a retired payment anyway, its `payment.*` event has no `checkoutSession` — the session
has moved on — but `payment.metadata.thru.sessionId` still names it; treat that as a stray to
reconcile by hand.

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
| `thru.payments.retrieve` | a payment, with its `checkoutSession` and cumulative `receivedAmount` |
| `amountBoundsOf(error)` | the `{ minAmount, maxAmount, currency }` a refused amount reports, or `null` |
| `verifyThruReturn(params, secret, { toleranceSeconds?, now? })` | the return page |
| `constructThruEvent(rawBody, headers, secret)` | webhooks — throws on failure |
| `isCheckoutSessionEvent(event)` | narrows to the session family |
| `isPaymentEvent(event)` | narrows to the payment family; switch on `event.type` inside |
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
