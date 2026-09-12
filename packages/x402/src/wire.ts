// The single home for every base64(JSON) envelope this package puts on the wire.
//
// INTERNAL: nothing here is re-exported from `index.ts` or any `exports` subpath. The public
// surface is `buildChallengeHeaders` / `gateRequest` / `decodeRequirementsFromHeader` (re-exported
// from `./challenge.js`) — this module is the shared implementation underneath them.
//
// WHY IT EXISTS: these envelope shapes used to be spelled out at four separate call sites
// (`challenge.ts`, `middleware.ts`, and twice in `testing/agent-client.ts`). Every one of them is
// parsed byte-for-byte by the facilitator in the sibling repo
// (`apps/api/src/facilitator/protocols/x402.codec.ts`), and `amountAtomic`/field *order* feeds
// signature and authHash derivation there — so a drifted copy is not a cosmetic problem, it is a
// payment that cannot be verified. One copy, pinned by golden-vector tests in `wire.spec.ts`.
//
// [PIN] Keep in sync with `x402.codec.ts#encodeRequirements` / `#decodeRequirements` /
// `#decodePaymentSignature` / `#encodeSettleResponse`. The SDK deliberately never imports
// `apps/api` code (spec §8, Task 10 note) — the wire format itself is the contract.
//
// No heavy dependencies here, ever: this module is on the import path of the middleware every
// merchant loads. `ethers` / `@mysten/sui` stay behind `await import()` in `testing/` and `payer`.

import type { RouteRequirements, Scheme } from './types.js';

/** x402 envelope version carried in every `PAYMENT-SIGNATURE` payload. */
export const X402_VERSION = 2;

function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

/**
 * Encode `RouteRequirements` to the base64(JSON) envelope that travels as the `PAYMENT-REQUIRED`
 * challenge header AND as `paymentRequirements` in the facilitator verify/settle body — the same
 * bytes in both places, by construction. Mirrors `x402.codec.ts#encodeRequirements`; bigints are
 * serialized as decimal strings.
 *
 * `protocol` is always `'x402'` even when the payment came back over MPP: the facilitator decodes
 * the requirements envelope with `decodeRequirements` regardless of which protocol's envelope
 * carried the payment itself.
 *
 * Key order below IS the wire format. Do not reorder, rename, or add fields without changing
 * `x402.codec.ts` in lockstep.
 */
export function encodeRequirementsEnvelope(req: RouteRequirements): string {
  return encodeBase64Json({
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
  });
}

/**
 * Decode a `PAYMENT-REQUIRED` base64(JSON) envelope back into route requirements. Exposed
 * publicly as `decodeRequirementsFromHeader` (see `./challenge.js`) and used internally by the
 * testing agent client to read a challenge it was served.
 */
export function decodeRequirementsEnvelope(b64: string): RouteRequirements & { protocol: 'x402' } {
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

/** The scheme-specific half of a `PAYMENT-SIGNATURE` envelope. Shapes per scheme are defined by
 * `x402.codec.ts#decodePaymentSignature`: `permit2_exact` → `{permit,transferTo,signature,payer}`,
 * `eip3009_exact` → `{auth,signature,payer}`, Sui → `{txBytesB64,senderSignatureB64,payer}`. */
export interface PaymentEnvelopeParts {
  scheme: Scheme;
  /** CAIP-2 (`eip155:97`, `sui:testnet`). The facilitator also accepts the short
   * `chain` + `network` form, but every payer in this package emits CAIP-2. */
  network: string;
  payload: Record<string, unknown>;
}

/**
 * Encode a `PAYMENT-SIGNATURE` base64(JSON) envelope. Mirrors the shape
 * `x402.codec.ts#decodePaymentSignature` parses. Key order below IS the wire format.
 */
export function encodePaymentEnvelope(parts: PaymentEnvelopeParts): string {
  return encodeBase64Json({
    x402Version: X402_VERSION,
    scheme: parts.scheme,
    network: parts.network,
    payload: parts.payload,
  });
}

/**
 * Encode the `PAYMENT-RESPONSE` header value a merchant returns alongside a settled request.
 *
 * NOTE: this package's field order (`success, txHash, network`) differs from the facilitator's own
 * `x402.codec.ts#encodeSettleResponse` (`success, network, txHash`). That is pre-existing, shipped
 * behaviour and deliberately left alone: nothing decodes this header order-sensitively (there is
 * no `decodeSettleResponse` anywhere, and it is never signed), so "fixing" it would change bytes
 * an integrator may already snapshot, for no gain. Fields are spelled out explicitly rather than
 * `JSON.stringify`-ing the caller's literal so the order can't drift with a call site.
 */
export function encodeSettleResponseEnvelope(r: {
  success: boolean;
  txHash?: string;
  network: string;
  reason?: string;
}): string {
  return encodeBase64Json({
    success: r.success,
    txHash: r.txHash,
    network: r.network,
    reason: r.reason,
  });
}
