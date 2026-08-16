// The headless data layer behind @thru-payment/pay-sdk's components: fetch +
// poll thru's public endpoints, expose typed state via hooks, nothing about
// how it's rendered. Bring your own UI and just consume these.

export { ThruProvider, useThru } from './provider.js';
export { createThruClient, type ThruClient } from './client.js';

export { usePayment, usePlan, useSubscription, type AsyncState } from './hooks.js';

export { themeToVars, mergeTheme, type ThruTheme } from './theme.js';

export { shorten, statusTone, statusLabel, formatDuration, type StatusTone } from './format.js';

export type {
  PublicPayment,
  PublicPlan,
  PublicSubscription,
  PublicPaymentTransaction,
} from './types.js';
