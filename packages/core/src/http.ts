import { ThruAPIError, ThruConnectionError, ThruError } from './errors';

const DEFAULT_BASE_URL = 'https://api.thru.la/v1';

export interface ThruClientOptions {
  /**
   * A server-to-server API key. Sent as the `x-api-key` header.
   * NEVER expose this in a browser; use the public read-only client there.
   */
  apiKey?: string;
  /** API base URL. Defaults to the thru production API. */
  baseUrl?: string;
  /** Custom fetch implementation (defaults to the global `fetch`). */
  fetch?: typeof fetch;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Max retries for idempotent requests on network / 5xx / 429 errors. Default 2. */
  maxRetries?: number;
  /** Extra headers sent on every request. */
  headers?: Record<string, string>;
}

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Sent as `Idempotency-Key`; makes a POST safe to retry. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/**
 * The transport all resource modules share: typed JSON requests with auth,
 * timeouts, retries with backoff on idempotent calls, and rich error mapping.
 */
export class HttpClient {
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: ThruClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new ThruError(
        'No fetch implementation found. Use Node 18+, a browser, or pass `fetch` in options.',
      );
    }
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.extraHeaders = options.headers ?? {};
  }

  get<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...lowerKeys(this.extraHeaders),
      ...lowerKeys(options.headers ?? {}),
    };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

    let body: string | undefined;
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const idempotent = method === 'GET' || method === 'DELETE' || Boolean(options.idempotencyKey);

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const signal = mergeSignals(options.signal, controller.signal);
      try {
        const response = await this.fetchImpl(url, { method, headers, body, signal });
        clearTimeout(timer);

        if (response.status === 204) return undefined as T;
        const text = await response.text();
        const data = text ? safeParse(text) : undefined;

        if (!response.ok) {
          if (idempotent && attempt < this.maxRetries && retryableStatus(response.status)) {
            await backoff(attempt);
            continue;
          }
          throw ThruAPIError.from(response.status, data, response.headers.get('x-request-id'));
        }
        return data as T;
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof ThruAPIError) throw error;
        if (isAbort(error) && options.signal?.aborted) {
          throw new ThruConnectionError('Request aborted by caller.', { cause: error });
        }
        if (idempotent && attempt < this.maxRetries) {
          await backoff(attempt);
          continue;
        }
        const reason = isAbort(error) ? `Request timed out after ${this.timeoutMs}ms` : messageOf(error);
        throw new ThruConnectionError(`thru: ${reason}`, { cause: error });
      }
    }
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const suffix = path.startsWith('/') ? path : `/${path}`;
    const search = new URLSearchParams();
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) search.append(key, String(value));
      }
    }
    const qs = search.toString();
    return `${this.baseUrl}${suffix}${qs ? `?${qs}` : ''}`;
  }
}

function retryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function backoff(attempt: number): Promise<void> {
  const ms = Math.min(1000 * 2 ** attempt, 8000) + Math.floor(deterministicJitter(attempt) * 250);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A tiny deterministic jitter (no Math.random dependency) to de-sync retries.
function deterministicJitter(attempt: number): number {
  const x = Math.sin(attempt * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function lowerKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value;
  return out;
}

function mergeSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const signal of [a, b]) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
