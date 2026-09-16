// The headless data layer behind @thru-payment/pay-sdk's components: fetch +
// poll thru's public endpoints, expose typed state via hooks, nothing about
// how it's rendered. Bring your own UI and just consume these.
//
// This entry is the React one. The framework-agnostic half — the same client,
// polling, terminal detection, theming and formatting with no React anywhere —
// is published separately at `@thru-payment/checkout-core/core`, for Vue,
// Svelte, Solid, or a plain <script>.

export { ThruProvider, useThru, useOptionalThru } from './provider.js';
export { createThruClient, DEFAULT_API_BASE_URL, type ThruClient } from './client.js';

export {
  usePayment,
  useThruStore,
  type AsyncState,
  type ThruHookOptions,
  type PollHookOptions,
} from './hooks.js';

export { themeToVars, mergeTheme, themeToCssVars, THRU_CSS_VARS, type ThruTheme } from './theme.js';

export { shorten, statusTone, statusLabel, formatDuration, type StatusTone } from './format.js';

// The framework-agnostic primitives, re-exported here so a React app can reach
// for them without a second import path.
export {
  createResourceStore,
  createIdleStore,
  createPaymentStore,
  isTerminalPaymentStatus,
  TERMINAL_PAYMENT_STATUSES,
  DEFAULT_PAYMENT_POLL_MS,
  type ThruStore,
  type StoreListener,
  type Unsubscribe,
  type ResourceStoreOptions,
} from './core/index.js';

export type { PublicPayment, PublicPaymentTransaction } from './types.js';
