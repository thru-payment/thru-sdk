// Resource-specific stores. Each one binds a `ThruClient` method to the generic
// poller in ./store.ts, with the interval and terminal rule that resource
// actually has. These are what a Vue composable / Svelte store / vanilla script
// consumes; the React hooks in ../hooks.ts are a thin wrapper over them.

import type { ThruClient } from '../client.js';
import type { PublicPayment } from '../types.js';
import {
  createResourceStore,
  withResourceDefaults,
  type ResourceStoreOptions,
  type ThruStore,
} from './store.js';

/** Poll interval used by the payment store and `usePayment` when unspecified. */
export const DEFAULT_PAYMENT_POLL_MS = 5000;

/**
 * Payment statuses that can never change again. Reaching one ends the poll.
 */
export const TERMINAL_PAYMENT_STATUSES: ReadonlySet<string> = new Set([
  'confirmed',
  'settled',
  'expired',
  'underpaid',
  'overpaid',
  'failed',
  'refunded',
]);

export function isTerminalPaymentStatus(status: string): boolean {
  return TERMINAL_PAYMENT_STATUSES.has(status);
}

/**
 * Watch a payment until it settles.
 *
 * Polls every `intervalMs` (default 5s) and stops on a terminal status.
 */
export function createPaymentStore(
  client: ThruClient,
  id: string,
  options?: ResourceStoreOptions<PublicPayment>,
): ThruStore<PublicPayment> {
  return createResourceStore(
    () => client.getPayment(id),
    withResourceDefaults<PublicPayment>(
      {
        intervalMs: DEFAULT_PAYMENT_POLL_MS,
        isTerminal: (payment) => isTerminalPaymentStatus(payment.status),
      },
      options,
    ),
  );
}
