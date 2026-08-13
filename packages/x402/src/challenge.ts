// Dual-protocol 402 challenge construction (spec §8): builds BOTH the x402 `PAYMENT-REQUIRED`
// header and the MPP `WWW-Authenticate: Payment` charge-intent challenge for a priced route, and
// extracts a client's returned payment envelope off either protocol's header.
//
// This is a client-side-only *reimplementation* of the wire shapes defined in
// `apps/api/src/facilitator/protocols/x402.codec.ts` / `mpp.codec.ts` — the SDK never imports
// `apps/api` code (spec §8, Task 10 note). Keep field names in sync with those codecs; any
// [PIN] wire-format changes made there must be mirrored here.

import { createHmac } from 'node:crypto';
import type { RouteRequirements } from './types.js';

const BOUND_PARAM_KEYS = [
  'intent',
  'scheme',
  'chain',
  'network',
  'asset',
  'amount',
  'payTo',
  'resource',
  'expires',
] as const;

type BoundParams = Record<(typeof BOUND_PARAM_KEYS)[number], string>;

function canonicalBoundParamString(params: BoundParams): string {
  return BOUND_PARAM_KEYS.map((key) => `${key}=${params[key]}`).join('&');
}

function computeBinding(params: BoundParams, hmacSecret: string): string {
  return createHmac('sha256', hmacSecret).update(canonicalBoundParamString(params)).digest('hex');
}

/**
 * Encode `RouteRequirements` to the base64(JSON) envelope carried in the `PAYMENT-REQUIRED`
 * header. Mirrors `x402.codec.ts#encodeRequirements`. Bigints are serialized as decimal strings.
 */
function encodeX402Requirements(req: RouteRequirements): string {
  const envelope = {
    protocol: 'x402' as const,
    scheme: req.scheme,
    chain: req.chain,
    network: req.network,
    asset: req.asset,
    amountAtomic: req.amountAtomic.toString(),
    payTo: req.payTo,
    resource: req.resource,
    maxTimeoutSeconds: req.maxTimeoutSeconds,
    extra: req.extra ?? {},
  };
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
}

/**
 * Decode a `PAYMENT-REQUIRED` base64(JSON) envelope back into route requirements, for testing
 * the roundtrip and for internal use by the testing agent client.
 */
export function decodeRequirementsFromHeader(b64: string): RouteRequirements & { protocol: 'x402' } {
  const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Record<string, unknown>;
  return {
    protocol: 'x402',
    scheme: parsed.scheme as RouteRequirements['scheme'],
    chain: parsed.chain as RouteRequirements['chain'],
    network: parsed.network as RouteRequirements['network'],
    asset: parsed.asset as string,
    amountAtomic: BigInt(parsed.amountAtomic as string),
    payTo: parsed.payTo as string,
    resource: parsed.resource as string,
    maxTimeoutSeconds: parsed.maxTimeoutSeconds as number,
    extra: (parsed.extra as Record<string, unknown>) ?? {},
  };
}

/**
 * Build the MPP `WWW-Authenticate: Payment <params>` charge-intent challenge value. Mirrors
 * `mpp.codec.ts#buildChallenge`.
 */
function buildMppChallenge(req: RouteRequirements, hmacSecret: string): string {
  const expires = Math.floor(Date.now() / 1000) + req.maxTimeoutSeconds;
  const bound: BoundParams = {
    intent: 'charge',
    scheme: req.scheme,
    chain: req.chain,
    network: req.network,
    asset: req.asset,
    amount: req.amountAtomic.toString(),
    payTo: req.payTo,
    resource: req.resource,
    expires: expires.toString(),
  };
  const binding = computeBinding(bound, hmacSecret);

  const parts = BOUND_PARAM_KEYS.map((key) => `${key}="${bound[key]}"`);
  parts.push(`binding="${binding}"`);
  return `Payment ${parts.join(', ')}`;
}

/**
 * Build the 402 challenge headers for a priced route (spec §8): x402's `PAYMENT-REQUIRED` and,
 * when an MPP secret is configured, MPP's `WWW-Authenticate` charge-intent challenge. Different
 * header names, so both coexist on a single 402 response and the paying agent picks whichever
 * protocol it speaks.
 *
 * `mppSecret` is OPTIONAL and has no default. The MPP binding is an HMAC that Thru re-derives
 * server-side to decode the returned credential, so a wrong or invented secret does not degrade
 * gracefully — it makes every MPP payment fail with `binding mismatch` while x402 keeps working.
 * A placeholder default would guarantee that half-broken state for anyone who forgot to configure
 * one, so instead the MPP challenge is simply not advertised unless the secret is real. Merchants
 * who only serve x402 clients need nothing here.
 */
export function buildChallengeHeaders(
  req: RouteRequirements,
  opts?: { mppSecret?: string },
): Record<string, string> {
  const headers: Record<string, string> = {
    'PAYMENT-REQUIRED': encodeX402Requirements(req),
  };
  if (opts?.mppSecret) {
    headers['WWW-Authenticate'] = buildMppChallenge(req, opts.mppSecret);
  }
  return headers;
}

export interface ExtractedPayment {
  protocol: 'x402' | 'mpp';
  envelope: string;
}

/**
 * Pull a returned payment envelope off request headers: `PAYMENT-SIGNATURE` (x402) takes
 * precedence, falling back to an `Authorization: Payment ...` header (MPP credential). Returns
 * `null` when neither is present. Header lookup is case-insensitive.
 */
export function extractPayment(headers: Record<string, string | undefined>): ExtractedPayment | null {
  const lower = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      lower.set(key.toLowerCase(), value);
    }
  }

  const paymentSignature = lower.get('payment-signature');
  if (paymentSignature) {
    return { protocol: 'x402', envelope: paymentSignature };
  }

  const authorization = lower.get('authorization');
  if (authorization && authorization.startsWith('Payment ')) {
    return { protocol: 'mpp', envelope: authorization };
  }

  return null;
}
