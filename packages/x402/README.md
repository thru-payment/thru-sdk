# `@thru-payment/x402`

Merchant middleware for charging machines. Gate an HTTP route behind a stablecoin payment: the
caller gets a `402` with a challenge, signs a payment authorization, retries, and Thru settles
on-chain. The payer needs no gas — Thru's relayer (BNB) or sponsor (Sui) covers it.

```ts
import express from 'express';
import { createFacilitatorClient } from '@thru-payment/x402';
import { paymentMiddleware } from '@thru-payment/x402/express';

const facilitator = createFacilitatorClient({ apiKey: process.env.THRU_API_KEY! });

const app = express();

app.use(paymentMiddleware(
  {
    'GET /reports/monthly': {
      scheme: 'permit2_exact',
      chain: 'bnb',
      network: 'testnet',
      asset: '0x55d398326f99059fF775485246999027B3197955', // BNB USDT
      amountAtomic: 100_000_000_000_000_000n,              // 0.10 × 1e18
      payTo: process.env.THRU_SETTLEMENT_ADDRESS!,
      resource: '/reports/monthly',
      maxTimeoutSeconds: 300,
    },
  },
  facilitator,
));

app.get('/reports/monthly', (_req, res) => res.json({ report: '…' }));
app.listen(3000);
```

The compiled, CI-typechecked version of this lives in
[`examples/express-server.ts`](examples/express-server.ts) and is the source of truth for every
snippet in Thru's docs.

## Install

Requires Node ≥ 20. `express` is an optional peer dependency — only needed for the
`@thru-payment/x402/express` adapter.

```bash
npm install @thru-payment/x402
```

## Entry points

| Import | Contains |
|---|---|
| `@thru-payment/x402` | `createFacilitatorClient`, `gateRequest`, `buildChallengeHeaders`, `extractPayment`, types |
| `@thru-payment/x402/express` | `paymentMiddleware` |
| `@thru-payment/x402/testing` | `createTestAgent` — an internal E2E harness, **not a supported product surface** |

`paymentMiddleware` is deliberately *not* on the root entry: the root carries no Express dependency
so the SDK stays usable in WinterCG runtimes (Workers, Deno, Bun) via `gateRequest`.

## API

### `createFacilitatorClient(opts)`

```ts
createFacilitatorClient({
  apiKey: string,      // your Thru API key — sent as `x-api-key`
  baseUrl?: string,    // default 'https://api.thru.la'
  fetch?: typeof fetch // injectable for testing
}): FacilitatorClient
```

Typed `verify` / `settle` / `supported` calls against Thru's facilitator. Non-2xx responses throw
`FacilitatorHttpError` carrying `.status` and `.body`.

### `paymentMiddleware(routes, client, opts?)`

**Three positional arguments.** There is no options-object form.

- `routes` — `Record<"METHOD /path", RouteRequirements>`
- `client` — from `createFacilitatorClient`
- `opts` — `{ verifyOnly?: boolean, mppSecret?: string }`

Route keys are matched by **exact string equality** against `` `${req.method.toUpperCase()} ${req.path}` ``.
No path params, no wildcards, no prefix matching — `'GET /users/:id'` never matches. Mounting under
`app.use('/api', …)` does not strip the prefix from `req.path`; key with the full path.

Unmatched requests call `next()` untouched.

### `RouteRequirements`

Every field is required except `extra`.

| Field | Type | Notes |
|---|---|---|
| `scheme` | `'permit2_exact' \| 'sui_sponsored'` | must match `chain` |
| `chain` | `'bnb' \| 'sui'` | the only chains the facilitator supports |
| `network` | `'mainnet' \| 'testnet'` | |
| `asset` | `string` | token address (BNB) or coin type (Sui) |
| `amountAtomic` | `bigint` | **not** a string or number |
| `payTo` | `string` | your settlement address |
| `resource` | `string` | URL or logical id of the paid resource |
| `maxTimeoutSeconds` | `number` | how long the challenge stays valid |
| `extra` | `Record<string, unknown>?` | optional passthrough |

`amountAtomic` is atomic units as a `bigint`. Decimals vary per asset — BNB USDT is **18**, Sui USDC
is **6**. Derive it rather than hand-writing zeros.

### `gateRequest(headers, route, client, opts?)`

Framework-agnostic core. Use it to build an adapter for any server.

```ts
const result = await gateRequest(headers, route, facilitator, opts);
```

| `result.kind` | Meaning | Shape |
|---|---|---|
| `'challenge'` | no payment presented | `{ status: 402, headers }` |
| `'proceed'` | payment settled (or verified) | `{ responseHeaders }` |
| `'error'` | rejected, or the facilitator call failed | `{ status: 402 \| 502, headers, body: { reason } }` |

Handle all three. Note `challenge`/`error` carry `headers` while `proceed` carries
`responseHeaders` — a missing `error` branch turns a rejected payment into a free response.

### `opts.verifyOnly`

Calls `verify` instead of `settle`: the payment is checked but **no funds move**. Only for routes
that settle out-of-band. Otherwise you are giving the resource away.

### `opts.mppSecret`

Optional, and deliberately has no default. Supplying it additionally advertises the MPP
(`WWW-Authenticate: Payment`) challenge alongside x402.

The MPP challenge is bound by an HMAC that **Thru re-derives server-side** to decode the returned
credential, so the value must be byte-identical to Thru's `FACILITATOR_MPP_HMAC_SECRET` — obtain it
from your Thru operator and treat it as a credential.

Without it, only the x402 challenge is offered, and an MPP credential arriving anyway is rejected
with `mpp_not_configured` rather than being forwarded. Earlier versions shipped a placeholder
default that could never match a real deployment, producing the worst failure mode available: x402
payments settling normally while every MPP payment died with an opaque `binding mismatch`.

If you only serve x402 clients, ignore this entirely.

## Discovering what's live

Chains, assets, caps, and the rotating relayer/sponsor addresses come from the facilitator, not
from config you pin:

```bash
curl https://api.thru.la/v1/facilitator/supported
```

```jsonc
{ "kinds": [ { "protocol": "x402", "scheme": "permit2_exact", "chain": "bnb", "network": "mainnet",
               "assets": [ { "address": "0x…", "symbol": "USDT", "decimals": 18,
                             "maxPaymentAtomic": "…" } ],
               "extra": { "spender": "0x…", "gasOwner": null } } ] }
```

`extra.spender` (Permit2 spender) and `extra.gasOwner` (Sui sponsor) **rotate** — read them at
runtime.

A `404` from this endpoint means the facilitator is disabled on that environment. It is deliberate:
a disabled facilitator 404s rather than revealing that it merely needs auth. It is not a bad key or
a routing bug.

## The wire

| Direction | Header | Carries |
|---|---|---|
| 402 out (x402) | `PAYMENT-REQUIRED` | base64(JSON) requirements |
| 402 out (MPP) | `WWW-Authenticate: Payment …` | `key="value"` params + `binding` HMAC |
| retry in (x402) | `PAYMENT-SIGNATURE` | base64(JSON) signed authorization |
| retry in (MPP) | `Authorization: Payment …` | echoed params + base64 `payload` |
| success out | `PAYMENT-RESPONSE` | base64(JSON) `{ success, txHash?, network }` |

`PAYMENT-SIGNATURE` takes precedence if a client sends both.

## Protocol compatibility

Thru's format is **x402/MPP-inspired, not byte-compatible** with canonical x402 or MPP. It is
internally consistent and tested, but a Coinbase x402 client or a Tempo/Stripe MPP agent will not
interoperate as-is:

- header is `PAYMENT-SIGNATURE`; canonical x402 uses `X-PAYMENT`
- scheme id is `permit2_exact`; canonical is `exact`
- requirements are a flat object; canonical x402 wraps them in `accepts: []` and names the amount
  `maxAmountRequired`
- the MPP `binding` HMAC and `method="sui-sponsored"` are Thru extensions

Full divergence table in `docs/facilitator-wire-format-review.md`.

## Errors

| `reason` | Cause |
|---|---|
| `mpp_not_configured` | an MPP credential arrived but no `mppSecret` is set |
| `binding mismatch …` | `mppSecret` ≠ Thru's `FACILITATOR_MPP_HMAC_SECRET` |
| `challenge expired` | payer exceeded `maxTimeoutSeconds`, or clock skew |
| `unknown_asset` | `asset` not in Thru's registry for that `(chain, network)` — usually a mainnet address on testnet |
| `amount_over_cap` | above the per-asset max or the merchant daily cap |
| *(HTTP 502)* | the facilitator call itself failed — not a payment rejection |

## Development

```bash
npm run build      # tsc -> dist/
npm run test       # jest, compiles from src/
npm run smoke      # loads the BUILT dist/ under Node's ESM resolver
npm run verify     # all of the above + typechecks examples/
```

`npm run test` alone is not sufficient: it compiles from `src/` with ts-jest's resolver and will
pass against a `dist/` that no consumer can import. `npm run smoke` is the check that matters
before publishing, and `prepublishOnly` runs `verify`.
