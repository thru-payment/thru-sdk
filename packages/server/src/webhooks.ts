import { hmacHex, safeEqualHex } from './hmac.js';
import type { CheckoutSessionEvent, ThruEvent } from './types.js';

/**
 * Verifying a thru webhook.
 *
 * The webhook is the authoritative fallback for a shopper who never came back to your site — a
 * closed tab, a dead battery, a wallet app that swallowed the redirect. thru writes the event in
 * the same database transaction that records the money, so "they paid" and "you will be told"
 * commit together.
 *
 * TWO THINGS YOUR HANDLER MUST DO
 * -------------------------------
 * 1. **Read the RAW body.** `await request.text()`, never `await request.json()`. The signature
 *    covers the exact bytes thru sent; re-serialising a parsed object changes key order and
 *    whitespace and the signature will not match.
 *
 * 2. **Answer 4xx/5xx when you could not handle it.** A 200 means "recorded" and thru stops
 *    retrying. Returning 200 for an event you could not map — an unknown plan, a database that was
 *    down — is how a paying customer silently never gets what they bought. Return 422 and let the
 *    retry schedule do its job.
 */

export const SIGNATURE_HEADER = 'x-thru-signature';
export const EVENT_TYPE_HEADER = 'x-thru-event';

export class ThruSignatureError extends Error {
  readonly reason: 'missing_signature' | 'bad_format' | 'bad_signature' | 'bad_payload';
  constructor(reason: ThruSignatureError['reason'], message: string) {
    super(message);
    this.name = 'ThruSignatureError';
    this.reason = reason;
  }
}

type HeaderSource = Headers | Record<string, string | string[] | undefined> | { get(name: string): string | null };

/**
 * Verify the signature and return the parsed event. Throws `ThruSignatureError` if it does not
 * verify — so a handler that forgets to check a boolean cannot accidentally trust the body.
 *
 * ```ts
 * const raw = await request.text();               // RAW, not .json()
 * const event = await constructThruEvent(raw, request.headers, env.THRU_WEBHOOK_SECRET);
 * ```
 */
export async function constructThruEvent(
  rawBody: string,
  headers: HeaderSource,
  secret: string,
): Promise<ThruEvent> {
  const header = readHeader(headers, SIGNATURE_HEADER);
  if (!header) {
    throw new ThruSignatureError('missing_signature', `missing ${SIGNATURE_HEADER} header`);
  }
  // Format is `sha256=<hex>`. The prefix is checked rather than stripped-if-present: accepting a
  // bare hex digest would mean accepting a future algorithm's signature as if it were this one.
  const match = /^sha256=([0-9a-f]{64})$/.exec(header.trim());
  if (!match || !match[1]) {
    throw new ThruSignatureError('bad_format', `malformed ${SIGNATURE_HEADER} header`);
  }

  const expected = await hmacHex(secret, rawBody);
  if (!safeEqualHex(expected, match[1])) {
    throw new ThruSignatureError('bad_signature', 'signature does not match the request body');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new ThruSignatureError('bad_payload', 'body is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed) || !('id' in parsed)) {
    throw new ThruSignatureError('bad_payload', 'body is not a thru event');
  }
  return parsed as ThruEvent;
}

/**
 * Narrow an event to the checkout-session family.
 *
 * All four `checkout.session.*` events carry an identical payload, and so does a one-off product,
 * a subscription product and an invoice — the irrelevant fields are null. One handler covers every
 * case, which is the whole reason to listen to these rather than to `payment.*`.
 */
export function isCheckoutSessionEvent(
  event: ThruEvent,
): event is ThruEvent & { type: `checkout.session.${string}`; data: CheckoutSessionEvent } {
  return typeof event.type === 'string' && event.type.startsWith('checkout.session.');
}

function readHeader(source: HeaderSource, name: string): string | null {
  if (typeof (source as { get?: unknown }).get === 'function') {
    return (source as Headers).get(name);
  }
  const record = source as Record<string, string | string[] | undefined>;
  const value = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
