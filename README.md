# thru SDKs

Merchant-facing SDKs for [thru](https://thru.la). Two packages, two different jobs — pick by who is
paying:

| Package | You are charging… | Runs in | Docs |
|---|---|---|---|
| [`@thru-payment/pay-sdk`](packages/pay-sdk) | a **human** — checkout, subscriptions | the browser (React) | [README](packages/pay-sdk/README.md) |
| [`@thru-payment/x402`](packages/x402) | a **machine** — AI agents paying per request | your server (Node) | [README](packages/x402/README.md) |

They are complementary, not alternatives. A merchant taking card-style crypto checkout *and*
selling an API to agents uses both.

## `@thru-payment/pay-sdk`

Embeddable, themeable checkout and Direct Pay subscribe components. Safe in the browser — it only
reads public, secret-free endpoints, so your secret API key never leaves your server.

```tsx
import { ThruProvider, ThruCheckout } from '@thru-payment/pay-sdk';
import '@thru-payment/pay-sdk/styles.css';
```

## `@thru-payment/x402`

Gate an HTTP route behind a stablecoin payment. The caller gets a `402` with a challenge, signs a
payment authorization, retries, and thru settles on-chain — the payer needs no gas.

```ts
import { createFacilitatorClient } from '@thru-payment/x402';
import { paymentMiddleware } from '@thru-payment/x402/express';
```

## Development

npm workspaces; Node ≥ 20.

```bash
npm install
npm run build          # both packages
npm run verify         # build + test + smoke, where defined
```

`@thru-payment/x402` additionally has `npm run x402:verify`, which builds, unit-tests, **smoke-tests the
built artifact under Node's own ESM resolver**, and typechecks the canonical example against the
published type surface. The unit tests alone are not sufficient — they compile from `src/` and will
pass against a `dist/` no consumer can import. That is not hypothetical; it is why the smoke test
exists.

## Releasing

Both packages are MIT, scoped `@thru-payment`, and already on npm
([`pay-sdk`](https://www.npmjs.com/package/@thru-payment/pay-sdk),
[`x402`](https://www.npmjs.com/package/@thru-payment/x402)). They're versioned and released
independently — bumping one never touches the other.

To ship a release, go to **Actions → Release → Run workflow**, pick the package and the version
bump (patch/minor/major), and run it. The workflow runs the exact same verify gate CI runs on every
push, then bumps the version, commits + tags it, pushes both back to `main`, and publishes to npm —
no local `npm publish` from anyone's machine.

One-time setup: add an npm [automation
token](https://docs.npmjs.com/creating-and-viewing-access-tokens) with publish rights for
`@thru-payment/*` as the repo secret `NPM_TOKEN` (Settings → Secrets and variables → Actions).

Note that npm does **not** require open source: the published tarball is only what `files` allows
(`dist` + docs), never the repository or its history. A private repo with a public package is a
normal combination.
