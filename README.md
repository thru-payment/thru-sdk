# thru SDK

The official SDK for [thru](https://thru.la) — the payment rail for crypto businesses.
One typed client for **payments, refunds, invoices, subscriptions, wallets, compliance,
escrow, agent payments and more**, across 25+ chains.

This is a monorepo of small, focused packages that are also aggregated into a single
`thru-sdk` package. Use the whole thing, or install only what you need.

```bash
npm install thru-sdk
```

## Quickstart

```ts
import { Thru } from 'thru-sdk';

const thru = new Thru({ apiKey: process.env.THRU_API_KEY });

// Accept a stablecoin payment on Base
const payment = await thru.payments.create({
  chain: 'base',
  token: 'USDC',
  amount: '25.00',
  currency: 'USD',
});

console.log(payment.paymentAddress); // send the customer here
```

> **Never** put a secret API key in a browser. For hosted checkout / subscribe widgets,
> use [`@thru/react`](./packages/react) which talks only to public read-only endpoints.

## Authentication

Create an API key in the dashboard (Developers → API keys). It authenticates as the
workspace `owner` and is sent as the `x-api-key` header automatically.

```ts
const thru = new Thru({
  apiKey: 'sk_live_...',
  // baseUrl defaults to https://api.thru.la/v1
});
```

See [docs/authentication.md](./docs/authentication.md).

## Packages

| Package | What it covers |
| --- | --- |
| [`thru-sdk`](./packages/sdk) | The aggregate client — everything below behind one `new Thru()`. |
| [`@thru/sdk-core`](./packages/core) | HTTP client, auth, typed errors, enums, webhook verification. |
| [`@thru/payments`](./packages/payments) | Payments, refunds, balances, settlement, sweeps, transactions. |
| [`@thru/billing`](./packages/billing) | Products, invoices, non-custodial subscriptions (Direct Pay). |
| [`@thru/compliance`](./packages/compliance) | KYC/KYB, AML screening, cases, on-chain escrow. |
| [`@thru/wallet`](./packages/wallet) | Workspace wallet overview, self-built MPC custody. |
| [`@thru/platform`](./packages/platform) | Account, API keys, webhook endpoints, workspaces, members. |
| [`@thru/facilitator`](./packages/facilitator) | Agent / machine payments over x402 + MPP. |
| [`@thru/intelligence`](./packages/intelligence) | Fund-flow tracing, address labels, investigations, event sources. |
| [`@thru/react`](./packages/react) | Embeddable, themeable checkout + subscribe React components. |

Each small package can be used on its own:

```ts
import { createPaymentsClient } from '@thru/payments';
const { payments, refunds } = createPaymentsClient({ apiKey: process.env.THRU_API_KEY });
```

## Common flows

**Refund a payment**
```ts
await thru.refunds.create(payment.id, { amount: '10.00', reason: 'partial refund' });
```

**Create an invoice and send it**
```ts
const invoice = await thru.invoices.create({
  customerName: 'Aria Chen',
  chain: 'sui',
  token: 'USDC',
  lineItems: [{ description: 'Pro plan (annual)', quantity: 1, unitAmount: '480.00' }],
});
await thru.invoices.send(invoice.id);
```

**Non-custodial subscription**
```ts
const plan = await thru.plans.create({
  name: 'Pro monthly', chain: 'base', token: 'USDC',
  receivingAddress: '0xYourWallet', price: '20.00', periodSeconds: 2592000,
});
const sub = await thru.subscriptions.create({
  planId: plan.id, userRef: 'user_123', payerAddress: '0xCustomer',
});
const { active } = await thru.subscriptions.entitlement('user_123');
```

**Verify a webhook** — see [docs/webhooks.md](./docs/webhooks.md)
```ts
import { constructWebhookEvent } from 'thru-sdk';

const event = await constructWebhookEvent({
  payload: rawBody,                      // the exact bytes, not a parsed object
  signature: req.headers['x-thru-signature'],
  secret: process.env.THRU_WEBHOOK_SECRET,
});
if (event.type === 'payment.confirmed') { /* ... */ }
```

## Errors

Every failure throws a typed error you can branch on:

```ts
import { ThruAuthError, ThruValidationError, ThruRateLimitError } from 'thru-sdk';

try {
  await thru.payments.create({ /* ... */ });
} catch (err) {
  if (err instanceof ThruValidationError) { /* fix the request */ }
  if (err instanceof ThruRateLimitError) { /* back off */ }
}
```

See [docs/errors.md](./docs/errors.md).

## Docs

- [Getting started](./docs/getting-started.md)
- [Authentication](./docs/authentication.md)
- [Payments & refunds](./docs/payments.md)
- [Webhooks](./docs/webhooks.md)
- [Errors & retries](./docs/errors.md)
- [React checkout components](./docs/react.md)

## Development

```bash
npm install
npm run build        # builds every package (tsup dual ESM/CJS + .d.ts)
npm run typecheck
```

Requires Node 18+ (uses the global `fetch` and Web Crypto).

## License

MIT
