# React checkout components

`@thru/react` gives you drop-in, fully themeable checkout and subscription UI. It talks
**only to public read-only endpoints**, so it is safe to run in the browser — no API key.

```bash
npm install @thru/react
```

```tsx
import { ThruProvider, ThruCheckout } from '@thru/react';
import '@thru/react/styles.css';

export function Checkout({ paymentId }: { paymentId: string }) {
  return (
    <ThruProvider baseUrl="https://api.thru.la/v1">
      <ThruCheckout paymentId={paymentId} />
    </ThruProvider>
  );
}
```

Create the payment on your **server** with `thru-sdk`, then pass its `id` to the browser.

## What's included

- `<ThruCheckout>` — a complete payment widget (amount, address, QR, live status).
- `<DirectPaySubscribe>` — a subscription widget for Direct Pay plans.
- Composable primitives — `<PaymentAmount>`, `<PaymentAddress>`, `<PaymentQRCode>`,
  `<PaymentStatusBadge>` — to build a custom UI.
- Hooks — `usePayment`, `usePlan`, `useSubscription` — for fully custom rendering.
- Theming — `ThruProvider theme={...}` / `themeToVars` to match your brand.

## Theming

```tsx
<ThruProvider
  baseUrl="https://api.thru.la/v1"
  theme={{ accent: '#1fd896', radius: '14px', font: 'Geist, sans-serif' }}
>
  <ThruCheckout paymentId={id} />
</ThruProvider>
```

See the package [README](../packages/react/README.md) for the full component and theme API.
