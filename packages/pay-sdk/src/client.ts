import type { PublicPayment, PublicPlan, PublicSubscription } from './types';

export type ThruClient = {
  baseUrl: string;
  getPayment(id: string): Promise<PublicPayment>;
  getPlan(id: string): Promise<PublicPlan>;
  getSubscription(id: string): Promise<PublicSubscription>;
};

/** A read-only client for thru's public endpoints. Never sends a secret key. */
export function createThruClient(baseUrl: string): ThruClient {
  const base = baseUrl.replace(/\/$/, '');

  async function get<T>(path: string): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`thru: request failed (${response.status})`);
    }
    return (await response.json()) as T;
  }

  return {
    baseUrl: base,
    getPayment: (id) => get<PublicPayment>(`/public/payments/${id}`),
    getPlan: (id) => get<PublicPlan>(`/public/direct-pay/plans/${id}`),
    getSubscription: (id) => get<PublicSubscription>(`/public/direct-pay/subscriptions/${id}`),
  };
}
