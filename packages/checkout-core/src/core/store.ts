// The one reactive primitive everything else in this package is built on.
//
// Deliberately React-free: a store is a plain object with `subscribe(listener)
// -> unsubscribe` and `getSnapshot()`. That pair is exactly what React's
// `useSyncExternalStore` consumes, what a Svelte store contract needs
// (`subscribe` returning an unsubscribe), and what a Vue composable or a plain
// `<script>` tag can drive by hand. The polling / terminal-detection logic that
// used to live inline inside a `useEffect` lives here instead, so a Vue or
// vanilla consumer gets it too.

/** The state every thru resource reports. Identical shape across frameworks. */
export type AsyncState<T> = {
  data: T | null;
  error: Error | null;
  loading: boolean;
};

export type Unsubscribe = () => void;

export type StoreListener<T> = (state: AsyncState<T>) => void;

export type ThruStore<T> = {
  /**
   * The current state. Referentially stable between changes — the same object
   * is returned until something actually changes, which is what
   * `useSyncExternalStore` requires to avoid an infinite render loop.
   */
  getSnapshot(): AsyncState<T>;
  /**
   * Register a listener and receive an unsubscribe function. With the default
   * `autoStart`, the first subscriber starts fetching and the last one to leave
   * tears the poll down, so a framework binding never has to manage lifecycle
   * beyond subscribe/unsubscribe.
   */
  subscribe(listener: StoreListener<T>): Unsubscribe;
  /** Begin fetching/polling. No-op while already running. */
  start(): void;
  /** Stop polling, cancel any pending timer, and ignore any in-flight fetch. */
  stop(): void;
  /** Fetch right now, restarting the poll schedule from this moment. */
  refresh(): Promise<void>;
};

export type ResourceStoreOptions<T> = {
  /**
   * Delay between polls in ms. `0` (the default) means fetch once and stop —
   * that is how the plan store works.
   */
  intervalMs?: number;
  /** Return true when the resource is final; polling then stops. */
  isTerminal?: (data: T) => boolean;
  /** Keep polling after a failed fetch. Default true (matches historic behaviour). */
  retryOnError?: boolean;
  /** Drop the previously loaded data when a fetch fails. Default false. */
  clearDataOnError?: boolean;
  /** Start on first subscriber and stop on last. Default true. */
  autoStart?: boolean;
};

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function applyOverrides<T>(
  defaults: ResourceStoreOptions<T>,
  overrides?: ResourceStoreOptions<T>,
): ResourceStoreOptions<T> {
  const merged: ResourceStoreOptions<T> = { ...defaults };
  if (!overrides) return merged;
  // A plain spread would let an explicit `{ intervalMs: undefined }` — which is
  // exactly what a React hook forwarding `options?.intervalMs` produces — wipe
  // out the default. Only defined values win.
  for (const key of Object.keys(overrides) as (keyof ResourceStoreOptions<T>)[]) {
    const value = overrides[key];
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

/** Merge caller options over a resource's defaults, ignoring `undefined`. */
export function withResourceDefaults<T>(
  defaults: ResourceStoreOptions<T>,
  overrides?: ResourceStoreOptions<T>,
): ResourceStoreOptions<T> {
  return applyOverrides(defaults, overrides);
}

/**
 * Build a store around any `() => Promise<T>` fetcher.
 *
 * This is the poll-until-terminal loop, lifted verbatim out of the React hooks:
 * fetch, publish, and reschedule unless the result is terminal; on failure
 * publish the error and (by default) keep retrying at the same interval.
 */
export function createResourceStore<T>(
  fetcher: () => Promise<T>,
  options: ResourceStoreOptions<T> = {},
): ThruStore<T> {
  const intervalMs = options.intervalMs ?? 0;
  const isTerminal = options.isTerminal;
  const retryOnError = options.retryOnError ?? true;
  const clearDataOnError = options.clearDataOnError ?? false;
  const autoStart = options.autoStart ?? true;
  const repeats = intervalMs > 0;

  // Starting as `loading: true` when we know a subscriber will kick a fetch
  // preserves the old `useState({ loading: Boolean(id) })` first paint: a
  // consumer rendering `loading ? <Spinner/> : <Empty/>` must not flash Empty.
  let state: AsyncState<T> = { data: null, error: null, loading: autoStart };

  const listeners = new Set<{ fn: StoreListener<T> }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let subscribers = 0;
  // Bumped on every stop/refresh so a fetch that resolves late is ignored.
  let generation = 0;

  function publish(next: AsyncState<T>): void {
    if (
      state.data === next.data &&
      state.error === next.error &&
      state.loading === next.loading
    ) {
      return;
    }
    state = next;
    for (const entry of [...listeners]) entry.fn(state);
  }

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function schedule(generationAtSchedule: number): void {
    timer = setTimeout(() => {
      timer = undefined;
      void tick(generationAtSchedule);
    }, intervalMs);
  }

  async function tick(generationAtStart: number): Promise<void> {
    try {
      const data = await fetcher();
      if (generationAtStart !== generation) return;
      publish({ data, error: null, loading: false });
      if (repeats && !(isTerminal?.(data) ?? false)) {
        schedule(generationAtStart);
      } else {
        running = false;
      }
    } catch (caught) {
      if (generationAtStart !== generation) return;
      publish({
        data: clearDataOnError ? null : state.data,
        error: toError(caught),
        loading: false,
      });
      if (repeats && retryOnError) {
        schedule(generationAtStart);
      } else {
        running = false;
      }
    }
  }

  function refresh(): Promise<void> {
    clearTimer();
    generation += 1;
    running = true;
    publish({ ...state, loading: true });
    return tick(generation);
  }

  function start(): void {
    if (running) return;
    void refresh();
  }

  function stop(): void {
    clearTimer();
    generation += 1;
    running = false;
    if (state.loading) publish({ ...state, loading: false });
  }

  function subscribe(listener: StoreListener<T>): Unsubscribe {
    // Wrapper objects, not the raw function: subscribing the same callback
    // twice must yield two independent unsubscribes.
    const entry = { fn: listener };
    listeners.add(entry);
    subscribers += 1;
    if (autoStart && subscribers === 1) start();
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      listeners.delete(entry);
      subscribers -= 1;
      if (autoStart && subscribers === 0) stop();
    };
  }

  return {
    getSnapshot: () => state,
    subscribe,
    start,
    stop,
    refresh,
  };
}

const IDLE_STATE: AsyncState<unknown> = Object.freeze({
  data: null,
  error: null,
  loading: false,
});

const IDLE_STORE: ThruStore<unknown> = Object.freeze({
  getSnapshot: () => IDLE_STATE,
  subscribe: () => () => {},
  start: () => {},
  stop: () => {},
  refresh: () => Promise.resolve(),
});

/**
 * A permanently-empty store, for "no id yet". Shared singleton, so its snapshot
 * is referentially stable and safe to hand straight to `useSyncExternalStore`.
 */
export function createIdleStore<T>(): ThruStore<T> {
  return IDLE_STORE as ThruStore<T>;
}
