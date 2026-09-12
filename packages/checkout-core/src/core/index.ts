// @thru-payment/checkout-core/core — the framework-agnostic entry.
//
// Everything here is plain TypeScript: no React import, no JSX, no `react` in
// the emitted .js or .d.ts. Import this from a Vue composable, a Svelte store, a
// Solid/Qwik/Angular service, or a plain <script> tag. The root entry
// (`@thru-payment/checkout-core`) is this plus the React provider and hooks.
//
//   import { createThruClient, createPaymentStore } from '@thru-payment/checkout-core/core';
//
//   const client = createThruClient();
//   const store = createPaymentStore(client, paymentId);
//   const stop = store.subscribe(({ data, error, loading }) => render(data));
//   // ... later
//   stop();

export { createThruClient, DEFAULT_API_BASE_URL, type ThruClient } from '../client.js';

export {
  createResourceStore,
  createIdleStore,
  withResourceDefaults,
  type AsyncState,
  type ThruStore,
  type StoreListener,
  type Unsubscribe,
  type ResourceStoreOptions,
} from './store.js';

export {
  createPaymentStore,
  createPlanStore,
  createSubscriptionStore,
  isTerminalPaymentStatus,
  TERMINAL_PAYMENT_STATUSES,
  DEFAULT_PAYMENT_POLL_MS,
  DEFAULT_SUBSCRIPTION_POLL_MS,
} from './resources.js';

export {
  themeToCssVars,
  mergeTheme,
  THRU_CSS_VARS,
  type ThruTheme,
} from './theme.js';

export {
  shorten,
  statusTone,
  statusLabel,
  formatDuration,
  type StatusTone,
} from '../format.js';

export type {
  PublicPayment,
  PublicPlan,
  PublicSubscription,
  PublicPaymentTransaction,
} from '../types.js';
