# @thru-payment/checkout-core

The headless data layer behind [`@thru-payment/pay-sdk`](../pay-sdk): a provider, a typed
read-only client, and a hook that polls thru's public payment endpoints. No components,
no CSS, no `qrcode`/`clsx` dependency - if you're building your own checkout UI from scratch and
just want thru's data and state, install this instead of `pay-sdk`.

If you want pre-built, themeable React components, use
[`@thru-payment/pay-sdk`](../pay-sdk) instead - it depends on this package and re-exports
everything here too, so you don't need both.

## Install

```bash
npm install @thru-payment/checkout-core
```

## Usage

```tsx
import { ThruProvider, usePayment } from '@thru-payment/checkout-core';

function MyCheckout({ paymentId }: { paymentId: string }) {
  const { data: payment, loading, error } = usePayment(paymentId);
  if (loading) return <MySpinner />;
  if (error || !payment) return <MyError />;
  // Render however you like - payment.status, payment.expectedAmount,
  // payment.paymentAddress, etc.
  return <MyOwnCheckoutMarkup payment={payment} />;
}

function App() {
  return (
    <ThruProvider apiBaseUrl="https://api.thru.la/v1">
      <MyCheckout paymentId={paymentId} />
    </ThruProvider>
  );
}
```

It is **safe to run in the browser**: it only reads public, secret-free endpoints. Your secret API
key never leaves your server.

You can also skip the provider entirely and hand a hook its own client:

```tsx
const client = createThruClient(); // defaults to https://api.thru.la/v1
const { data } = usePayment(paymentId, { client });
```

## Without React

`react` is an **optional** peer dependency. Everything except `ThruProvider` and the `use*` hooks
is framework-agnostic and published at the `./core` subpath, which contains no React import at
runtime or in its types - install this package in a Vue, Svelte, Solid or vanilla app and nothing
will ask for React.

Each resource is a small store: `subscribe(listener)` returns an unsubscribe, `getSnapshot()`
returns the current `{ data, error, loading }`. The first subscriber starts the poll and the last
one to leave tears it down, so lifecycle is just subscribe/unsubscribe. This is the same logic the
React hooks run - they are a `useSyncExternalStore` wrapper over exactly these stores.

```ts
import { createThruClient, createPaymentStore } from '@thru-payment/checkout-core/core';

const client = createThruClient();
const store = createPaymentStore(client, paymentId); // polls 5s, stops when settled

const unsubscribe = store.subscribe(({ data, error, loading }) => {
  render(data);
});
// later
unsubscribe();
```

A Vue composable is then about six lines:

```ts
import { ref, onScopeDispose } from 'vue';
import { createPaymentStore } from '@thru-payment/checkout-core/core';

export function usePayment(client, id) {
  const store = createPaymentStore(client, id);
  const state = ref(store.getSnapshot());
  onScopeDispose(store.subscribe((next) => (state.value = next)));
  return state;
}
```

`subscribe` already matches Svelte's store contract, so `$store` works directly on a Svelte store
wrapper too.

## Exports

Root (`@thru-payment/checkout-core`) - React:

- Provider: `ThruProvider`, `useThru`, `useOptionalThru`
- Hooks: `usePayment`, `useThruStore`, `AsyncState`
- Theming: `themeToVars` (React `CSSProperties`)
- ...plus everything in `./core` below, re-exported.

`./core` (`@thru-payment/checkout-core/core`) - no React:

- Client: `createThruClient`, `DEFAULT_API_BASE_URL`, `ThruClient`
- Stores: `createPaymentStore`, `createResourceStore`, `createIdleStore`, `ThruStore`,
  `AsyncState`, `ResourceStoreOptions`, `Unsubscribe`
- Status: `isTerminalPaymentStatus`, `TERMINAL_PAYMENT_STATUSES`, `DEFAULT_PAYMENT_POLL_MS`
- Theming: `themeToCssVars`, `mergeTheme`, `THRU_CSS_VARS`, `ThruTheme`
- Utilities: `shorten`, `statusTone`, `statusLabel`, `formatDuration`, `StatusTone`
- Types: `PublicPayment`, `PublicPaymentTransaction`

### Polling behaviour

| Resource | Interval | Stops when |
| --- | --- | --- |
| Payment | 5s | status is `confirmed`, `settled`, `expired`, `underpaid`, `overpaid`, `failed`, `refunded` |

`expired` is terminal for the POLL, not for the money: thru still credits a late transfer to an
expired payment's address. If your surface has to see that, keep a store alive with your own
`isTerminal`:

```ts
createPaymentStore(client, id, { isTerminal: (p) => p.status === 'confirmed' });
createPaymentStore(client, id, { retryOnError: false }); // stop hammering an id that 404s
```

## License

MIT
