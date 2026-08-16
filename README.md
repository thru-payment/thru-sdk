# thru SDKs

Merchant-facing SDKs for [thru](https://thru.la). Three packages — pick by who's paying, and by how
much of the UI you want built for you:

| Package | You are charging… | Runs in | Docs |
|---|---|---|---|
| [`@thru-payment/checkout-core`](packages/checkout-core) | a **human** — headless data layer, no UI | the browser (React) | [README](packages/checkout-core/README.md) |
| [`@thru-payment/pay-sdk`](packages/pay-sdk) | a **human** — pre-built checkout, subscriptions | the browser (React) | [README](packages/pay-sdk/README.md) |
| [`@thru-payment/x402`](packages/x402) | a **machine** — AI agents paying per request | your server (Node) | [README](packages/x402/README.md) |

`pay-sdk` depends on `checkout-core` and re-exports everything it has — install `checkout-core`
alone only if you're building your own checkout UI and don't want `pay-sdk`'s `qrcode`/`clsx`
dependencies. `x402` is unrelated to both: a merchant taking card-style crypto checkout *and*
selling an API to agents uses `pay-sdk` (or `checkout-core`) *and* `x402`.

## `@thru-payment/checkout-core`

The provider, typed client, and hooks (`usePayment`, `usePlan`, `useSubscription`) that poll thru's
public endpoints. No components, no styling deps — bring your own UI.

```tsx
import { ThruProvider, usePayment } from '@thru-payment/checkout-core';
```

## `@thru-payment/pay-sdk`

Embeddable, themeable checkout and Direct Pay subscribe components, built on `checkout-core`. Safe
in the browser — it only reads public, secret-free endpoints, so your secret API key never leaves
your server.

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
npm run build          # checkout-core -> pay-sdk, then x402
npm run verify         # build + typecheck + smoke, and (x402) test - everything CI runs
```

`checkout-core` and `x402` each smoke-test their **built artifact** under Node's own ESM resolver,
not just the unit tests / typecheck. `tsc` without a bundler will silently emit extensionless
relative imports under the wrong `moduleResolution`, producing a `dist/` that only loads inside a
bundler and throws `ERR_MODULE_NOT_FOUND` for every real consumer — both packages have hit that bug
once. `npm run verify` in either package's directory runs its smoke test; a green unit-test suite
alone does not catch this class of bug.

## Releasing

All three packages are MIT and scoped `@thru-payment`. `pay-sdk` and `x402` are already on npm
([`pay-sdk`](https://www.npmjs.com/package/@thru-payment/pay-sdk),
[`x402`](https://www.npmjs.com/package/@thru-payment/x402)); `checkout-core` is new and not yet
published. All three are versioned and released independently — bumping one never touches the
others. (`pay-sdk`'s `package.json` pins a `^0.1.0` range on `checkout-core`; bumping
`checkout-core` to a new minor/major needs a follow-up `pay-sdk` release that widens the range,
same as any other dependency.)

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
