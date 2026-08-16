# @thru-payment/checkout-core

The headless data layer behind [`@thru-payment/pay-sdk`](../pay-sdk): a provider, a typed
read-only client, and hooks that poll thru's public checkout/subscription endpoints. No components,
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

## Exports

- Provider: `ThruProvider`, `useThru`
- Client: `createThruClient`, `ThruClient`
- Hooks: `usePayment`, `usePlan`, `useSubscription`, `AsyncState`
- Theming: `themeToVars`, `mergeTheme`, `ThruTheme` (CSS-variable helpers - useful even without
  `pay-sdk`'s components if you want to theme your own markup with the same tokens)
- Utilities: `shorten`, `statusTone`, `statusLabel`, `formatDuration`, `StatusTone`
- Types: `PublicPayment`, `PublicPlan`, `PublicSubscription`, `PublicPaymentTransaction`

## License

MIT
