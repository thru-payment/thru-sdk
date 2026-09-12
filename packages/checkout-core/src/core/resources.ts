// Resource-specific stores. Each one binds a `ThruClient` method to the generic
// poller in ./store.ts, with the interval and terminal rule that resource
// actually has. These are what a Vue composable / Svelte store / vanilla script
// consumes; the React hooks in ../hooks.ts are a thin wrapper over the same
// three functions.

import type { ThruClient } from '../client.js';
import type { PublicPayment, PublicPlan, PublicSubscription } from '../types.js';
import {
  createResourceStore,
  withResourceDefaults,
  type ResourceStoreOptions,
  type ThruStore,
} from './store.js';

/** Poll interval used by the payment store and `usePayment` when unspecified. */
export const DEFAULT_PAYMENT_POLL_MS = 5000;

/** Poll interval used by the subscription store and `useSubscription` when unspecified. */
export const DEFAULT_SUBSCRIPTION_POLL_MS = 8000;

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

/**
 * Fetch a plan once. Plans are static, so there is nothing to poll; `refresh()`
 * re-fetches on demand.
 */
export function createPlanStore(
  client: ThruClient,
  id: string,
  options?: ResourceStoreOptions<PublicPlan>,
): ThruStore<PublicPlan> {
  return createResourceStore(
    () => client.getPlan(id),
    withResourceDefaults<PublicPlan>(
      { intervalMs: 0, clearDataOnError: true },
      options,
    ),
  );
}

/**
 * Watch a subscription.
 *
 * Polls every `intervalMs` (default 8s) and — unlike a payment — does not stop
 * on its own. That is not an oversight: a thru subscription has no terminal
 * status. Its lifecycle is `pending` -> `active` -> `expired` -> `active`
 * again, because an expired subscription is revived by the next on-chain
 * payment. A subscribe widget has to keep watching to see `pending` flip to
 * `active`, and a dashboard has to keep watching to see a renewal land.
 *
 * If your surface only cares about one transition, end the poll yourself with
 * `isTerminal`, e.g. `{ isTerminal: (s) => s.active }` to stop once the
 * subscription first goes live. `retryOnError: false` likewise stops the
 * otherwise-endless retry against an id that 404s.
 */
export function createSubscriptionStore(
  client: ThruClient,
  id: string,
  options?: ResourceStoreOptions<PublicSubscription>,
): ThruStore<PublicSubscription> {
  return createResourceStore(
    () => client.getSubscription(id),
    withResourceDefaults<PublicSubscription>(
      { intervalMs: DEFAULT_SUBSCRIPTION_POLL_MS },
      options,
    ),
  );
}
