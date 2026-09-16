/**
 * The whole cryptographic surface of this package: HMAC-SHA256 and a constant-time hex compare.
 *
 * Web Crypto only. No `node:crypto`, no `Buffer`, no `timingSafeEqual` — none of those exist on
 * Cloudflare Workers, which is where thru's first integrator runs. `crypto.subtle` is a global on
 * Node 20+, Workers, Deno and Bun, so one implementation serves all four.
 */

const encoder = new TextEncoder();

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** Lowercase hex HMAC-SHA256 of `message` under `secret`. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await importKey(secret), encoder.encode(message));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compare two hex strings without leaking where they first differ.
 *
 * A naive `a === b` returns as soon as it finds a mismatched character, and the time that takes is
 * a measurable oracle an attacker can use to recover a valid signature one character at a time.
 * The loop below always reads every character.
 *
 * The early return on length is deliberate and safe: the length of a SHA-256 hex digest is public.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
