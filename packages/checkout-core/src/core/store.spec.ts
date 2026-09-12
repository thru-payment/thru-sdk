import { jest } from '@jest/globals';
import { createResourceStore, createIdleStore, type AsyncState } from './store.js';
import {
  createPaymentStore,
  createPlanStore,
  createSubscriptionStore,
  isTerminalPaymentStatus,
} from './resources.js';
import type { ThruClient } from '../client.js';
import type { PublicPayment, PublicPlan, PublicSubscription } from '../types.js';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function payment(status: string): PublicPayment {
  return {
    id: 'pay_1',
    chain: 'sui',
    network: 'mainnet',
    token: 'USDC',
    currency: 'USD',
    expectedAmount: '10',
    receivedAmount: '0',
    paymentAddress: '0xabc',
    status,
    expiresAt: '2030-01-01T00:00:00.000Z',
    createdAt: '2030-01-01T00:00:00.000Z',
  };
}

function subscription(status: string, active: boolean): PublicSubscription {
  return { id: 'sub_1', planId: 'plan_1', status, active };
}

const plan: PublicPlan = {
  id: 'plan_1',
  name: 'Pro',
  chain: 'sui',
  network: 'mainnet',
  token: 'USDC',
  receivingAddress: '0xabc',
  price: '10',
  periodSeconds: 2592000,
};

/** A client whose reads are scripted, so the poll loop is fully observable. */
function scriptedClient(script: {
  payments?: Array<PublicPayment | Error>;
  plans?: Array<PublicPlan | Error>;
  subscriptions?: Array<PublicSubscription | Error>;
}) {
  const calls = { getPayment: 0, getPlan: 0, getSubscription: 0 };
  function next<T>(list: Array<T | Error> | undefined, index: number): Promise<T> {
    const value = list?.[Math.min(index, (list?.length ?? 1) - 1)];
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(value as T);
  }
  const client: ThruClient = {
    baseUrl: 'https://example.test/v1',
    getPayment: () => next<PublicPayment>(script.payments, calls.getPayment++),
    getPlan: () => next<PublicPlan>(script.plans, calls.getPlan++),
    getSubscription: () => next<PublicSubscription>(script.subscriptions, calls.getSubscription++),
  };
  return { client, calls };
}

function collect<T>(store: { subscribe: (l: (s: AsyncState<T>) => void) => () => void }) {
  const states: AsyncState<T>[] = [];
  const unsubscribe = store.subscribe((s) => states.push(s));
  return { states, unsubscribe };
}

describe('createResourceStore', () => {
  it('starts on the first subscriber and reports loading before any data', async () => {
    const fetcher = jest.fn<() => Promise<number>>(async () => 1);
    const store = createResourceStore(fetcher);

    // The pre-subscribe snapshot is already `loading: true`, so a consumer that
    // renders `loading ? spinner : empty` never flashes empty on first paint.
    expect(store.getSnapshot()).toEqual({ data: null, error: null, loading: true });
    expect(fetcher).not.toHaveBeenCalled();

    const { unsubscribe } = collect<number>(store);
    await jest.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ data: 1, error: null, loading: false });
    unsubscribe();
  });

  it('returns a referentially stable snapshot between changes', async () => {
    const store = createResourceStore(async () => 1);
    const { unsubscribe } = collect<number>(store);
    await jest.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    unsubscribe();
  });

  it('stops polling when the last subscriber leaves', async () => {
    const fetcher = jest.fn<() => Promise<number>>(async () => 1);
    const store = createResourceStore(fetcher, { intervalMs: 1000 });

    const a = collect<number>(store);
    const b = collect<number>(store);
    await jest.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1); // one loop, not one per subscriber

    await jest.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(2);

    a.unsubscribe();
    await jest.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(3); // b still listening

    b.unsubscribe();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(3); // torn down
  });

  it('gives each duplicate subscription of the same callback its own unsubscribe', async () => {
    const fetcher = jest.fn<() => Promise<number>>(async () => 1);
    const store = createResourceStore(fetcher, { intervalMs: 1000 });
    const listener = () => {};
    const first = store.subscribe(listener);
    const second = store.subscribe(listener);
    await jest.advanceTimersByTimeAsync(0);

    first();
    await jest.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(2); // second still holds it open

    second();
    await jest.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('ignores an in-flight fetch that resolves after teardown', async () => {
    let resolve!: (value: number) => void;
    const store = createResourceStore(() => new Promise<number>((r) => (resolve = r)));
    const { states, unsubscribe } = collect<number>(store);
    unsubscribe();
    resolve(42);
    await jest.advanceTimersByTimeAsync(0);
    expect(states).toHaveLength(0);
    expect(store.getSnapshot().data).toBeNull();
  });

  it('does not let an explicitly undefined option clobber a resource default', async () => {
    const { client, calls } = scriptedClient({ payments: [payment('detected')] });
    // This is exactly the shape a React hook forwarding `options?.intervalMs`
    // passes when the caller gave no interval. A plain spread would turn the
    // 5000ms default into `undefined` and collapse the poll to a single fetch.
    const store = createPaymentStore(client, 'pay_1', { intervalMs: undefined });
    const { unsubscribe } = collect<PublicPayment>(store);
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(5000);
    expect(calls.getPayment).toBe(2);
    unsubscribe();
  });
});

describe('createPaymentStore', () => {
  it('polls every 5s and stops at a terminal status', async () => {
    const { client, calls } = scriptedClient({
      payments: [payment('waiting_for_payment'), payment('detected'), payment('confirmed')],
    });
    const store = createPaymentStore(client, 'pay_1');
    const { unsubscribe } = collect<PublicPayment>(store);

    await jest.advanceTimersByTimeAsync(0);
    expect(calls.getPayment).toBe(1);

    await jest.advanceTimersByTimeAsync(5000);
    expect(calls.getPayment).toBe(2);

    await jest.advanceTimersByTimeAsync(5000);
    expect(calls.getPayment).toBe(3);
    expect(store.getSnapshot().data?.status).toBe('confirmed');

    // Terminal: no further polling, ever.
    await jest.advanceTimersByTimeAsync(60_000);
    expect(calls.getPayment).toBe(3);
    unsubscribe();
  });

  it('keeps the last good data and retries after a failed poll', async () => {
    const { client, calls } = scriptedClient({
      payments: [payment('detected'), new Error('boom'), payment('settled')],
    });
    const store = createPaymentStore(client, 'pay_1');
    const { unsubscribe } = collect<PublicPayment>(store);

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(5000);
    expect(store.getSnapshot().error?.message).toBe('boom');
    expect(store.getSnapshot().data?.status).toBe('detected'); // data preserved

    await jest.advanceTimersByTimeAsync(5000);
    expect(calls.getPayment).toBe(3);
    expect(store.getSnapshot().error).toBeNull();
    expect(store.getSnapshot().data?.status).toBe('settled');
    unsubscribe();
  });

  it('honours a custom interval', async () => {
    const { client, calls } = scriptedClient({ payments: [payment('detected')] });
    const store = createPaymentStore(client, 'pay_1', { intervalMs: 250 });
    const { unsubscribe } = collect<PublicPayment>(store);
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(250);
    expect(calls.getPayment).toBe(2);
    unsubscribe();
  });

  it('classifies terminal statuses', () => {
    for (const s of ['confirmed', 'settled', 'expired', 'underpaid', 'overpaid', 'failed', 'refunded']) {
      expect(isTerminalPaymentStatus(s)).toBe(true);
    }
    for (const s of ['waiting_for_payment', 'detected', 'confirming', 'pending']) {
      expect(isTerminalPaymentStatus(s)).toBe(false);
    }
  });
});

describe('createPlanStore', () => {
  it('fetches once and never polls', async () => {
    const { client, calls } = scriptedClient({ plans: [plan] });
    const store = createPlanStore(client, 'plan_1');
    const { unsubscribe } = collect<PublicPlan>(store);

    await jest.advanceTimersByTimeAsync(0);
    expect(calls.getPlan).toBe(1);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(calls.getPlan).toBe(1);
    expect(store.getSnapshot().data).toEqual(plan);
    unsubscribe();
  });

  it('clears data and does not retry on failure', async () => {
    const { client, calls } = scriptedClient({ plans: [new Error('nope')] });
    const store = createPlanStore(client, 'plan_1');
    const { unsubscribe } = collect<PublicPlan>(store);

    await jest.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot()).toEqual({
      data: null,
      error: expect.any(Error),
      loading: false,
    });
    await jest.advanceTimersByTimeAsync(60_000);
    expect(calls.getPlan).toBe(1);
    unsubscribe();
  });

  it('refetches on refresh()', async () => {
    const { client, calls } = scriptedClient({ plans: [plan] });
    const store = createPlanStore(client, 'plan_1');
    const { unsubscribe } = collect<PublicPlan>(store);
    await jest.advanceTimersByTimeAsync(0);
    await store.refresh();
    expect(calls.getPlan).toBe(2);
    unsubscribe();
  });
});

describe('createSubscriptionStore', () => {
  it('polls every 8s and does not stop on its own', async () => {
    // Deliberate: a thru subscription has no terminal status. `expired` is
    // revived by the next on-chain payment, so the widget must keep watching.
    const { client, calls } = scriptedClient({
      subscriptions: [subscription('pending', false), subscription('active', true)],
    });
    const store = createSubscriptionStore(client, 'sub_1');
    const { unsubscribe } = collect<PublicSubscription>(store);

    await jest.advanceTimersByTimeAsync(0);
    expect(calls.getSubscription).toBe(1);
    await jest.advanceTimersByTimeAsync(8000 * 4);
    expect(calls.getSubscription).toBe(5);

    // ...but it does stop the moment nobody is listening.
    unsubscribe();
    await jest.advanceTimersByTimeAsync(8000 * 4);
    expect(calls.getSubscription).toBe(5);
  });

  it('accepts an isTerminal opt-out that ends the poll', async () => {
    const { client, calls } = scriptedClient({
      subscriptions: [subscription('pending', false), subscription('active', true)],
    });
    const store = createSubscriptionStore(client, 'sub_1', {
      isTerminal: (s) => s.active,
    });
    const { unsubscribe } = collect<PublicSubscription>(store);

    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(8000);
    expect(calls.getSubscription).toBe(2);
    await jest.advanceTimersByTimeAsync(8000 * 10);
    expect(calls.getSubscription).toBe(2);
    unsubscribe();
  });

  it('stops retrying a permanently failing id when asked', async () => {
    const { client, calls } = scriptedClient({ subscriptions: [new Error('404')] });
    const store = createSubscriptionStore(client, 'sub_1', { retryOnError: false });
    const { unsubscribe } = collect<PublicSubscription>(store);
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(8000 * 10);
    expect(calls.getSubscription).toBe(1);
    unsubscribe();
  });
});

describe('createIdleStore', () => {
  it('is permanently empty and safe to subscribe to', () => {
    const store = createIdleStore<PublicPayment>();
    expect(store.getSnapshot()).toEqual({ data: null, error: null, loading: false });
    expect(store.getSnapshot()).toBe(createIdleStore<PublicPlan>().getSnapshot());
    expect(() => store.subscribe(() => {})()).not.toThrow();
  });
});
