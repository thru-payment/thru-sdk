import { useEffect, useRef, useState } from 'react';
import { useThru } from './provider';
import type { PublicPayment, PublicPlan, PublicSubscription } from './types';

const TERMINAL_PAYMENT = new Set([
  'confirmed', 'settled', 'expired', 'underpaid', 'overpaid', 'failed', 'refunded',
]);

export type AsyncState<T> = {
  data: T | null;
  error: Error | null;
  loading: boolean;
};

/** Poll a payment's public status until it reaches a terminal state. */
export function usePayment(
  id?: string,
  options?: { intervalMs?: number },
): AsyncState<PublicPayment> {
  const { client } = useThru();
  const [state, setState] = useState<AsyncState<PublicPayment>>({
    data: null,
    error: null,
    loading: Boolean(id),
  });
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!id) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    const interval = options?.intervalMs ?? 5000;

    const tick = async () => {
      try {
        const payment = await client.getPayment(id);
        if (cancelled) return;
        setState({ data: payment, error: null, loading: false });
        if (!TERMINAL_PAYMENT.has(payment.status)) {
          timer.current = setTimeout(tick, interval);
        }
      } catch (error) {
        if (cancelled) return;
        setState((s) => ({ ...s, error: error as Error, loading: false }));
        timer.current = setTimeout(tick, interval);
      }
    };

    setState((s) => ({ ...s, loading: true }));
    void tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id, client, options?.intervalMs]);

  return state;
}

/** Fetch a plan's public details once. */
export function usePlan(id?: string): AsyncState<PublicPlan> {
  const { client } = useThru();
  const [state, setState] = useState<AsyncState<PublicPlan>>({
    data: null,
    error: null,
    loading: Boolean(id),
  });

  useEffect(() => {
    if (!id) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    client
      .getPlan(id)
      .then((plan) => {
        if (!cancelled) setState({ data: plan, error: null, loading: false });
      })
      .catch((error) => {
        if (!cancelled) setState({ data: null, error: error as Error, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [id, client]);

  return state;
}

/** Poll a subscription's public status (active / expiresAt change over time). */
export function useSubscription(
  id?: string,
  options?: { intervalMs?: number },
): AsyncState<PublicSubscription> {
  const { client } = useThru();
  const [state, setState] = useState<AsyncState<PublicSubscription>>({
    data: null,
    error: null,
    loading: Boolean(id),
  });
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!id) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    const interval = options?.intervalMs ?? 8000;

    const tick = async () => {
      try {
        const subscription = await client.getSubscription(id);
        if (cancelled) return;
        setState({ data: subscription, error: null, loading: false });
        timer.current = setTimeout(tick, interval);
      } catch (error) {
        if (cancelled) return;
        setState((s) => ({ ...s, error: error as Error, loading: false }));
        timer.current = setTimeout(tick, interval);
      }
    };

    setState((s) => ({ ...s, loading: true }));
    void tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id, client, options?.intervalMs]);

  return state;
}
