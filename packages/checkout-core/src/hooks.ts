// The React binding, and nothing else.
//
// All the fetching, polling, terminal detection, retry and teardown logic lives
// in ./core — these hooks only build the right store and hand it to
// `useSyncExternalStore`. If you find yourself adding a `setTimeout` or a
// `TERMINAL_*` set to this file, it belongs in ./core/store.ts or
// ./core/resources.ts instead, so non-React consumers get it too.

import { useMemo, useSyncExternalStore } from 'react';
import { useOptionalThru } from './provider.js';
import type { ThruClient } from './client.js';
import type { PublicPayment } from './types.js';
import { createIdleStore, type AsyncState, type ThruStore } from './core/store.js';
import { createPaymentStore } from './core/resources.js';

export type { AsyncState } from './core/store.js';

/** Options every hook accepts, on top of its own. */
export type ThruHookOptions = {
  /**
   * Use this client instead of the one from `<ThruProvider>`. With it, the
   * hooks work with no provider in the tree at all.
   */
  client?: ThruClient;
};

export type PollHookOptions = ThruHookOptions & {
  /** Poll interval in ms. */
  intervalMs?: number;
};

function useResolvedClient(explicit?: ThruClient): ThruClient {
  const ctx = useOptionalThru();
  if (explicit) return explicit;
  if (!ctx) {
    throw new Error(
      'thru components must be wrapped in <ThruProvider>, or given an explicit `client` option.',
    );
  }
  return ctx.client;
}

/**
 * Subscribe React to any `ThruStore` — including one you built yourself from
 * `@thru-payment/checkout-core/core` with custom options.
 *
 *   const store = useMemo(
 *     () => createPaymentStore(client, id, { intervalMs: 2000 }),
 *     [client, id],
 *   );
 *   const { data } = useThruStore(store);
 */
export function useThruStore<T>(store: ThruStore<T>): AsyncState<T> {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Poll a payment's public status until it reaches a terminal state. */
export function usePayment(id?: string, options?: PollHookOptions): AsyncState<PublicPayment> {
  const client = useResolvedClient(options?.client);
  const intervalMs = options?.intervalMs;
  const store = useMemo(
    () => (id ? createPaymentStore(client, id, { intervalMs }) : createIdleStore<PublicPayment>()),
    [client, id, intervalMs],
  );
  return useThruStore(store);
}
