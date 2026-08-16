// Headless data layer - provider, client, hooks, theming, types. Re-exported
// here so existing `@thru-payment/pay-sdk` imports keep working unchanged,
// but it's also its own package (@thru-payment/checkout-core) for anyone who
// wants thru's data/state without any of the components below.
export {
  ThruProvider,
  useThru,
  createThruClient,
  type ThruClient,
  usePayment,
  usePlan,
  useSubscription,
  type AsyncState,
  themeToVars,
  mergeTheme,
  type ThruTheme,
  shorten,
  statusTone,
  statusLabel,
  formatDuration,
  type StatusTone,
  type PublicPayment,
  type PublicPlan,
  type PublicSubscription,
  type PublicPaymentTransaction,
} from '@thru-payment/checkout-core';

// Utilities
export { cn } from './cn';
export { toQrDataUrl } from './qr';

// Composable primitives
export { ThruRoot, partClass } from './components/primitives';
export { PaymentAmount } from './components/PaymentAmount';
export { PaymentAddress } from './components/PaymentAddress';
export { PaymentQRCode } from './components/PaymentQRCode';
export { PaymentStatusBadge } from './components/PaymentStatusBadge';

// Drop-in widgets
export {
  ThruCheckout,
  type ThruCheckoutClassNames,
  type ThruCheckoutLabels,
} from './components/ThruCheckout';
export {
  DirectPaySubscribe,
  type DirectPaySubscribeClassNames,
  type DirectPaySubscribeLabels,
} from './components/DirectPaySubscribe';
