# @thru-payment/pay-sdk

Embeddable, **fully themeable** crypto checkout and subscription components for
[thru](https://thru.la). Drop a payment or Direct Pay subscribe widget into your
own pages and restyle it to match your brand - from a one-line theme override all
the way down to a headless render with your own markup.

It is **safe to run in the browser**: the SDK only reads public, secret-free
endpoints. Your secret API key never leaves your server.

> Building your own checkout UI from scratch and don't want any of the components below? The
> provider, client and hooks are also their own package,
> [`@thru-payment/checkout-core`](../checkout-core) - install that instead and skip `pay-sdk`'s
> `qrcode`/`clsx` dependencies entirely. `pay-sdk` depends on it and re-exports everything it has,
> so you never need both.

## Install

```bash
npm install @thru-payment/pay-sdk
```

```tsx
import { ThruProvider, ThruCheckout } from '@thru-payment/pay-sdk';
import '@thru-payment/pay-sdk/styles.css'; // optional default theme
```

## How it works

1. Your **backend** creates a payment (`POST /v1/payments`) or a Direct Pay plan
   and subscription with your secret key.
2. You pass the returned **id** to a component.
3. The component renders the checkout and **polls public status** until it
   confirms - no secret key in the browser.

```tsx
function App() {
  return (
    <ThruProvider apiBaseUrl="https://api.thru.la/v1">
      <ThruCheckout paymentId={paymentId} onStatusChange={(p) => console.log(p.status)} />
    </ThruProvider>
  );
}
```

```tsx
// Direct Pay subscription
<DirectPaySubscribe planId={planId} subscriptionId={subscriptionId} />
```

## Theming - four layers, pick any

**1. Theme tokens** (quickest):

```tsx
<ThruProvider theme={{ colorAccent: '#6d28d9', radius: '20px', fontFamily: 'Inter' }}>
  ...
</ThruProvider>
// or per component:
<ThruCheckout paymentId={id} theme={{ colorAccent: '#111' }} />
```

Tokens: `colorBg, colorSurface, colorBorder, colorText, colorMuted, colorAccent,
colorAccentText, colorSuccess, colorWarning, colorDanger, radius, fontFamily,
fontMono, spacing`. Each maps to a `--thru-*` CSS variable you can also set
yourself.

**2. Per-part `classNames`** (bring your own CSS / Tailwind):

```tsx
<ThruCheckout
  paymentId={id}
  classNames={{
    root: 'rounded-3xl shadow-xl',
    header: 'mb-2',
    qr: 'bg-black',
    address: 'font-mono text-xs',
    status: 'uppercase',
  }}
/>
```

**3. Headless** - drop the default classes and style everything yourself:

```tsx
<ThruCheckout paymentId={id} unstyled classNames={{ root: 'my-checkout' }} />
```

**4. Fully custom** - build your own layout from the hooks and primitives (the hooks work the same
whether you import them from `pay-sdk` or standalone from
[`@thru-payment/checkout-core`](../checkout-core)):

```tsx
import { usePayment, ThruRoot, PaymentQRCode, PaymentAddress, PaymentStatusBadge } from '@thru-payment/pay-sdk';

function MyCheckout({ paymentId }: { paymentId: string }) {
  const { data: p } = usePayment(paymentId);
  if (!p) return null;
  return (
    <ThruRoot>
      <h2>{p.expectedAmount} {p.token}</h2>
      <PaymentStatusBadge status={p.status} />
      <PaymentQRCode value={p.paymentAddress} size={240} />
      <PaymentAddress address={p.paymentAddress} />
    </ThruRoot>
  );
}
```

You can also pass `renderHeader` / `renderFooter` to `ThruCheckout` for partial
overrides, and `labels` to customize copy.

## Exports

- Widgets: `ThruCheckout`, `DirectPaySubscribe`
- Primitives: `ThruRoot`, `PaymentAmount`, `PaymentAddress`, `PaymentQRCode`, `PaymentStatusBadge`
- Utils only `pay-sdk` has: `cn`, `toQrDataUrl` (the `qrcode`/`clsx`-backed ones)
- Everything else - `usePayment`, `usePlan`, `useSubscription`, `createThruClient`, `themeToVars`,
  `mergeTheme`, `shorten`, `statusTone`, `statusLabel`, `formatDuration`, `ThruProvider`, `useThru`
  - is re-exported from [`@thru-payment/checkout-core`](../checkout-core), which you can also
  import directly if you don't want the components above.

## License

MIT
