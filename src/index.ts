// Provider + client
export { ThruProvider, useThru } from './provider';
export { createThruClient, type ThruClient } from './client';

// Hooks (build fully custom UIs on top of these)
export { usePayment, usePlan, useSubscription, type AsyncState } from './hooks';

// Theming
export { themeToVars, mergeTheme, type ThruTheme } from './theme';

// Utilities
export { cn } from './cn';
export { toQrDataUrl } from './qr';
export { shorten, statusTone, statusLabel, formatDuration, type StatusTone } from './format';

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

// Types
export type {
  PublicPayment,
  PublicPlan,
  PublicSubscription,
  PublicPaymentTransaction,
} from './types';
