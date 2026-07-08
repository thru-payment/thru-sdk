import { ThruError } from './errors';

/** The signature header thru sends on every webhook delivery. */
export const THRU_SIGNATURE_HEADER = 'x-thru-signature';
/** The event-type header thru sends alongside the signature. */
export const THRU_EVENT_HEADER = 'x-thru-event';

/** A delivered webhook event. `data` is the event-specific payload. */
export interface ThruWebhookEvent<T = unknown> {
  id: string;
  type: string;
  createdAt: string;
  data: T;
}

/**
 * Verify a webhook delivery's HMAC-SHA256 signature.
 *
 * @param payload   The exact raw request body (string). Do NOT re-serialize a
 *                  parsed object — signatures are over the bytes thru sent.
 * @param signature The `x-thru-signature` header, e.g. `sha256=<hex>`.
 * @param secret    The endpoint secret returned when you created the webhook.
 * @returns true when the signature is valid.
 */
export async function verifyWebhookSignature(params: {
  payload: string;
  signature: string;
  secret: string;
}): Promise<boolean> {
  const provided = params.signature.trim().replace(/^sha256=/i, '');
  if (!provided) return false;
  const expected = await hmacSha256Hex(params.secret, params.payload);
  return timingSafeEqual(provided.toLowerCase(), expected);
}

/**
 * Verify a webhook and return the parsed event. Throws `ThruError` when the
 * signature is invalid or the body is not valid JSON. Use this in your handler.
 */
export async function constructWebhookEvent<T = unknown>(params: {
  payload: string;
  signature: string;
  secret: string;
}): Promise<ThruWebhookEvent<T>> {
  const valid = await verifyWebhookSignature(params);
  if (!valid) {
    throw new ThruError('thru: invalid webhook signature');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(params.payload);
  } catch (error) {
    throw new ThruError('thru: webhook payload is not valid JSON', { cause: error });
  }
  const event = parsed as ThruWebhookEvent<T>;
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') {
    throw new ThruError('thru: webhook payload is not a thru event');
  }
  return event;
}

/** Read the signature from a headers object (Node req.headers, fetch Headers, or a map). */
export function readSignatureHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
): string | null {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(THRU_SIGNATURE_HEADER);
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const value = record[THRU_SIGNATURE_HEADER] ?? record[THRU_SIGNATURE_HEADER.toLowerCase()];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new ThruError('Web Crypto is unavailable; webhook verification needs Node 18+ or a browser.');
  }
  const encoder = new TextEncoder();
  const key = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await subtle.sign('HMAC', key, encoder.encode(payload));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison to avoid signature timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
