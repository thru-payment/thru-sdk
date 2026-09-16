import type {
  CheckoutSession,
  CheckoutSessionList,
  CreateCheckoutSessionParams,
  ListCheckoutSessionsParams,
} from './types.js';
import { DEFAULT_API_BASE_URL } from './types.js';

/** A thru API error, with the status and whatever the API said. */
export class ThruApiError extends Error {
  readonly status: number;
  readonly payload: unknown;
  constructor(status: number, message: string, payload?: unknown) {
    super(message);
    this.name = 'ThruApiError';
    this.status = status;
    this.payload = payload;
  }
}

export type ThruServerClientOptions = {
  /**
   * Your secret API key. SERVER ONLY.
   *
   * There is deliberately no browser build of this package and no way to pass a key from the
   * client: a key that reaches a browser can mint payments and read every customer reference you
   * have ever set.
   */
  apiKey: string;
  /** Defaults to https://api.thru.la/v1. */
  baseUrl?: string;
  /** Injectable for tests and for runtimes with a scoped fetch. Defaults to the global. */
  fetch?: typeof fetch;
};

export type ThruServerClient = {
  baseUrl: string;
  checkout: {
    sessions: {
      /** Create a session and get the URL to send the shopper to. */
      create(params: CreateCheckoutSessionParams): Promise<CheckoutSession>;
      /**
       * The authoritative answer to "did they pay?".
       *
       * Call this before granting anything. A signed return tells you what thru saw at a moment in
       * time; this tells you what is true now.
       */
      retrieve(id: string): Promise<CheckoutSession>;
      /**
       * Walk your sessions, newest first.
       *
       * Paginated on a monotonic keyset, so `createdAfter` a stored watermark plus `nextCursor`
       * will find every sale — including one whose webhook never arrived and whose shopper never
       * came back. This is the layer underneath the other two.
       */
      list(params?: ListCheckoutSessionsParams): Promise<CheckoutSessionList>;
      /** Close a session you no longer want redeemed. */
      expire(id: string): Promise<CheckoutSession>;
    };
  };
};

export function createThruServerClient(options: ThruServerClientOptions): ThruServerClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');
  const doFetch = options.fetch ?? globalThis.fetch;
  if (!options.apiKey) throw new Error('thru: apiKey is required');
  if (typeof doFetch !== 'function') {
    throw new Error('thru: no fetch available — pass one via `fetch`');
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await doFetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        // thru authenticates server-to-server with x-api-key, not a Bearer token.
        'x-api-key': options.apiKey,
        ...init?.headers,
      },
    });

    const text = await response.text();
    const payload: unknown = text ? safeJson(text) : undefined;
    if (!response.ok) {
      throw new ThruApiError(response.status, messageOf(payload, response.status), payload);
    }
    return payload as T;
  }

  const sessions = {
    create: (params: CreateCheckoutSessionParams) =>
      request<CheckoutSession>('/checkout/sessions', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    retrieve: (id: string) => request<CheckoutSession>(`/checkout/sessions/${encodeURIComponent(id)}`),
    list: (params: ListCheckoutSessionsParams = {}) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) query.set(key, String(value));
      }
      const suffix = query.toString();
      return request<CheckoutSessionList>(`/checkout/sessions${suffix ? `?${suffix}` : ''}`);
    },
    expire: (id: string) =>
      request<CheckoutSession>(`/checkout/sessions/${encodeURIComponent(id)}/expire`, {
        method: 'POST',
        body: '{}',
      }),
  };

  return { baseUrl, checkout: { sessions } };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageOf(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('; ');
  }
  return `thru: request failed (${status})`;
}
