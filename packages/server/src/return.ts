import { hmacHex, safeEqualHex } from './hmac.js';
import type { ReturnOutcome } from './types.js';

/**
 * Verifying the shopper's return from thru's hosted checkout.
 *
 * WHAT A VERIFIED RETURN PROVES, AND WHAT IT DOES NOT
 * ---------------------------------------------------
 * It proves: at unix second `thru_ts`, thru observed session `thru_session` in status
 * `thru_status`. That is authenticated, it costs no network call, and it is enough to RENDER — your
 * success page can say "Pro is active" immediately instead of showing a spinner that races a
 * webhook.
 *
 * It is NOT enough to GRANT. Stablecoin settlement is asynchronous: a shopper handed `pending` can
 * still go on to underpay, and a `completed` page can be reopened from browser history a week
 * later. Neither is forgery — both are staleness, and no signature can fix staleness. Only reading
 * current state can.
 *
 * So the rule is: **render on the signature, grant on the retrieve.** This function's return type
 * enforces it — it carries a session id and a status and nothing else. There is no amount, no
 * reference and no plan on it, so there is nothing to grant from without calling
 * `thru.checkout.sessions.retrieve(...)` first.
 */

export const RETURN_PARAM_SESSION = 'thru_session';
export const RETURN_PARAM_STATUS = 'thru_status';
export const RETURN_PARAM_TIMESTAMP = 'thru_ts';
export const RETURN_PARAM_SIGNATURE = 'thru_sig';

/** Version prefix on the signed message. If thru ever signs more, old verifiers fail loudly. */
const SIGNATURE_VERSION = 'thru.v1';

/** Default window for a return to still count as fresh. A shopper may read the page first. */
export const DEFAULT_RETURN_TOLERANCE_SECONDS = 900;

export type VerifiedReturn =
  | { verified: true; sessionId: string; status: ReturnOutcome }
  | {
      verified: false;
      sessionId: string | null;
      status: null;
      reason: 'missing_parameters' | 'bad_timestamp' | 'expired' | 'bad_signature';
    };

export type VerifyReturnOptions = {
  /** How stale a return may be, in seconds. Default 900. */
  toleranceSeconds?: number;
  /** Injectable clock, for tests. */
  now?: Date;
};

/**
 * Verify the `thru_*` query parameters on your return page.
 *
 * Accepts anything parameter-shaped: a `URLSearchParams`, a `URL`, a plain object (Next.js
 * `searchParams`), or the full URL as a string.
 *
 * ```ts
 * const ret = await verifyThruReturn(searchParams, env.THRU_CHECKOUT_SECRET);
 * if (!ret.verified) return <BillingError />;
 * const session = await thru.checkout.sessions.retrieve(ret.sessionId); // grant on THIS
 * ```
 */
export async function verifyThruReturn(
  input: URLSearchParams | URL | string | Record<string, string | string[] | undefined>,
  secret: string,
  options: VerifyReturnOptions = {},
): Promise<VerifiedReturn> {
  const params = toParams(input);
  const sessionId = params[RETURN_PARAM_SESSION] ?? null;
  const status = params[RETURN_PARAM_STATUS] as ReturnOutcome | undefined;
  const ts = params[RETURN_PARAM_TIMESTAMP];
  const signature = params[RETURN_PARAM_SIGNATURE];

  if (!sessionId || !status || !ts || !signature) {
    return { verified: false, sessionId, status: null, reason: 'missing_parameters' };
  }

  const seconds = Number(ts);
  if (!Number.isFinite(seconds)) {
    return { verified: false, sessionId, status: null, reason: 'bad_timestamp' };
  }

  const tolerance = options.toleranceSeconds ?? DEFAULT_RETURN_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - seconds) > tolerance) {
    return { verified: false, sessionId, status: null, reason: 'expired' };
  }

  const expected = await hmacHex(secret, `${SIGNATURE_VERSION}|${sessionId}|${status}|${ts}`);
  if (!safeEqualHex(expected, signature)) {
    return { verified: false, sessionId, status: null, reason: 'bad_signature' };
  }
  return { verified: true, sessionId, status };
}

function toParams(
  input: URLSearchParams | URL | string | Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  if (typeof input === 'string') {
    // A full URL, or a bare query string with or without the leading '?'.
    try {
      return fromSearchParams(new URL(input).searchParams);
    } catch {
      return fromSearchParams(new URLSearchParams(input.replace(/^\?/, '')));
    }
  }
  if (input instanceof URL) return fromSearchParams(input.searchParams);
  if (input instanceof URLSearchParams) return fromSearchParams(input);

  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(input)) {
    // A repeated parameter is ambiguous, and picking one of two values is how a verifier ends up
    // checking a different string than the one the framework will hand the rest of the app.
    out[key] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

function fromSearchParams(params: URLSearchParams): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  // `forEach` rather than `entries()`: the iterator form needs DOM.Iterable, and this package
  // deliberately does not compile against the DOM libs so it cannot reach a browser-only global.
  params.forEach((value, key) => {
    if (!(key in out)) out[key] = value;
  });
  return out;
}
