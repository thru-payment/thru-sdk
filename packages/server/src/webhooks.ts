import { hmacHex, safeEqualHex } from './hmac.js';
import type { CheckoutSessionEvent, PaymentEventType, ThruEvent } from './types.js';

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
 *    retrying. Returning 200 for an event you could not map — an unknown product, a database that was
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
 * All four `checkout.session.*` events carry an identical payload, and so do a product and an
 * invoice — the irrelevant fields are null. One handler covers every
 * case, which is the whole reason to listen to these rather than to `payment.*`.
 */
export function isCheckoutSessionEvent(
  event: ThruEvent,
): event is ThruEvent & { type: `checkout.session.${string}`; data: CheckoutSessionEvent } {
  return typeof event.type === 'string' && event.type.startsWith('checkout.session.');
}

/**
 * Narrow an event to the payment family: `payment.confirmed`, `.underpaid`, `.overpaid`,
 * `.refunded` and `.expired`.
 *
 * This is the family to listen to when the AMOUNT is the question — a custom-amount top-up
 * credited from what arrived rather than a plan granted because it was paid for. Inside the
 * guard, `event.type` discriminates: the four money events carry `data.payment` and
 * `data.blockchainTransaction`; `payment.expired` is flat and carries only the lapsed quote.
 * All five carry `data.checkoutSession` when the payment belongs to a session, and it is ABSENT
 * (not null) when it does not — so check for it before reading `reference`.
 */
export function isPaymentEvent(
  event: ThruEvent,
): event is Extract<ThruEvent, { type: PaymentEventType }> {
  return typeof event.type === 'string' && event.type.startsWith('payment.');
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
