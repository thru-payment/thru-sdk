# Getting started

## Install

```bash
npm install thru-sdk
# or a single package:
npm install @thru/payments @thru/sdk-core
```

Node 18+ is required (the SDK uses the global `fetch` and Web Crypto). It also runs in
Deno, Bun, Cloudflare Workers and other modern runtimes. For older Node, pass a `fetch`
polyfill:

```ts
import fetch from 'node-fetch';
const thru = new Thru({ apiKey, fetch });
```

## Create a client

```ts
import { Thru } from 'thru-sdk';

const thru = new Thru({
  apiKey: process.env.THRU_API_KEY,   // from Dashboard → Developers → API keys
  baseUrl: 'https://api.thru.la/v1',  // default; override for a self-hosted API
  timeoutMs: 30_000,                  // per-request timeout (default 30s)
  maxRetries: 2,                      // retries on network / 5xx / 429 for idempotent calls
});
```

## Your first payment

```ts
const payment = await thru.payments.create({
  chain: 'base',
  token: 'USDC',
  amount: '25.00',
  currency: 'USD',
  metadata: { orderId: 'ord_1024' },
});

// Show the address / QR to your customer:
console.log(payment.paymentAddress, payment.expectedAmount, payment.expiresAt);

// Poll for status, or (better) listen for webhooks:
const latest = await thru.payments.retrieve(payment.id);
console.log(latest.status); // waiting_for_payment | confirming | confirmed | ...
```

## Idempotency

Pass `idempotencyKey` to make `payments.create` safe to retry — the same key returns the
same payment instead of creating a duplicate.

```ts
await thru.payments.create({ chain: 'base', token: 'USDC', amount: '25.00', currency: 'USD', idempotencyKey: 'ord_1024' });
```

## Next

- [Authentication](./authentication.md)
- [Payments & refunds](./payments.md)
- [Webhooks](./webhooks.md)
