// Facilitator API client (spec §8): typed `verify` / `settle` / `supported` calls against Thru's
// facilitator endpoints (spec §7). fetch-based, zero heavy deps — safe to bundle into any WinterCG
// runtime as well as Node/Express.

import type { FacilitatorRequestBody, SettleResponseBody, SupportedKinds, VerifyResponseBody } from './types.js';

// thru's production API domain. (An earlier draft used `api.thru.gg`, which was
// never registered — DNS for it does not resolve. The real edge is `thru.la`,
// see Caddyfile.)
const DEFAULT_BASE_URL = 'https://api.thru.la';

export class FacilitatorHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Facilitator request failed with status ${status}`);
    this.name = 'FacilitatorHttpError';
    this.status = status;
    this.body = body;
  }
}

export interface FacilitatorClient {
  verify(body: FacilitatorRequestBody): Promise<VerifyResponseBody>;
  settle(body: FacilitatorRequestBody): Promise<SettleResponseBody>;
  supported(): Promise<SupportedKinds>;
}

export interface CreateFacilitatorClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injectable for testing; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/**
 * Create a typed client for Thru's facilitator API (`x-api-key` authed except `/supported`, which
 * is public but still reachable through this client for convenience).
 */
export function createFacilitatorClient(opts: CreateFacilitatorClientOptions): FacilitatorClient {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;

  async function request<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<T> {
    const response = await doFetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: {
        'x-api-key': opts.apiKey,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

    const json = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new FacilitatorHttpError(response.status, json);
    }
    return json as T;
  }

  return {
    verify(body: FacilitatorRequestBody) {
      return request<VerifyResponseBody>('/v1/facilitator/verify', { method: 'POST', body });
    },
    settle(body: FacilitatorRequestBody) {
      return request<SettleResponseBody>('/v1/facilitator/settle', { method: 'POST', body });
    },
    supported() {
      return request<SupportedKinds>('/v1/facilitator/supported', { method: 'GET' });
    },
  };
}
