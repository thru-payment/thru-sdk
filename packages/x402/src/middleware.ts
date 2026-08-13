// Framework-agnostic payment-gate core (spec §8, plan Task 11). `express.ts` and any future
// WinterCG fetch adapter both drive requests through `gateRequest` — the actual HTTP framework
// binding lives only in the adapter files.

import { buildChallengeHeaders, extractPayment } from './challenge.js';
import type { FacilitatorClient } from './client.js';
import type { FacilitatorRequestBody, RouteRequirements } from './types.js';

export type PaymentGateResult =
  | { kind: 'challenge'; status: 402; headers: Record<string, string> }
  | { kind: 'proceed'; responseHeaders: Record<string, string> }
  | { kind: 'error'; status: 402 | 502; headers: Record<string, string>; body: { reason: string } };

export interface GateRequestOptions {
  /** When true, only `client.verify` is called (no settlement) and the request is allowed through
   * on a valid payment without moving funds. Escape hatch for routes that settle out-of-band. */
  verifyOnly?: boolean;
  /**
   * HMAC secret binding the MPP challenge (spec §8). Obtain it from your Thru operator — Thru
   * re-derives the same binding server-side to decode the returned credential.
   *
   * OPTIONAL and intentionally undefaulted: when omitted, only the x402 challenge is advertised.
   * An invented default would not fail closed, it would fail *confusingly* — x402 payments would
   * settle while every MPP payment died with `binding mismatch`.
   */
  mppSecret?: string;
}

/**
 * Core payment gate: given inbound request headers, the route's price, and a facilitator client,
 * decide whether to challenge (402), proceed (payment settled/verified), or error (facilitator
 * rejected the payment, or the facilitator call itself failed).
 */
export async function gateRequest(
  headers: Record<string, string | undefined>,
  route: RouteRequirements,
  client: FacilitatorClient,
  opts?: GateRequestOptions,
): Promise<PaymentGateResult> {
  const mppSecret = opts?.mppSecret;
  const extracted = extractPayment(headers);

  if (!extracted) {
    return {
      kind: 'challenge',
      status: 402,
      headers: buildChallengeHeaders(route, { mppSecret }),
    };
  }

  // An MPP credential can only be decoded by Thru against the secret that bound the challenge.
  // Without one configured we never advertised MPP, so a credential arriving on that path is
  // either a misconfiguration or a client guessing — reject it here rather than forwarding a
  // payload the facilitator is guaranteed to reject with an opaque `binding mismatch`.
  if (extracted.protocol === 'mpp' && !mppSecret) {
    return {
      kind: 'error',
      status: 402,
      headers: buildChallengeHeaders(route, { mppSecret }),
      body: { reason: 'mpp_not_configured' },
    };
  }

  const body: FacilitatorRequestBody = {
    protocol: extracted.protocol,
    paymentPayload: extracted.envelope,
    paymentRequirements: encodeRequirementsForBody(route),
  };

  try {
    if (opts?.verifyOnly) {
      const result = await client.verify(body);
      if (!result.valid) {
        return rejectionToError(result.reason, route, mppSecret);
      }
      return {
        kind: 'proceed',
        responseHeaders: {
          'PAYMENT-RESPONSE': encodeSettleResponseHeader({ success: true, network: route.network }),
        },
      };
    }

    const result = await client.settle(body);
    if (!result.success) {
      return rejectionToError(result.reason, route, mppSecret);
    }
    return {
      kind: 'proceed',
      responseHeaders: {
        'PAYMENT-RESPONSE': encodeSettleResponseHeader({
          success: true,
          txHash: result.txHash,
          network: route.network,
        }),
      },
    };
  } catch (err) {
    return {
      kind: 'error',
      status: 502,
      headers: {},
      body: { reason: err instanceof Error ? err.message : 'facilitator_unreachable' },
    };
  }
}

function rejectionToError(
  reason: string | undefined,
  route: RouteRequirements,
  mppSecret: string | undefined,
): PaymentGateResult {
  return {
    kind: 'error',
    status: 402,
    headers: buildChallengeHeaders(route, { mppSecret }),
    body: { reason: reason ?? 'payment_rejected' },
  };
}

/** Base64(JSON) encoding of `RouteRequirements`, matching `x402.codec.ts#encodeRequirements`'s
 * wire shape (bigints as decimal strings) so the facilitator can decode it regardless of which
 * protocol's envelope carried the payment. */
function encodeRequirementsForBody(route: RouteRequirements): string {
  const envelope = {
    protocol: 'x402' as const,
    scheme: route.scheme,
    chain: route.chain,
    network: route.network,
    asset: route.asset,
    amountAtomic: route.amountAtomic.toString(),
    payTo: route.payTo,
    resource: route.resource,
    maxTimeoutSeconds: route.maxTimeoutSeconds,
    extra: route.extra ?? {},
  };
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
}

/** Base64(JSON) encoding for the `PAYMENT-RESPONSE` header, mirroring
 * `x402.codec.ts#encodeSettleResponse`'s wire shape. */
function encodeSettleResponseHeader(r: {
  success: boolean;
  txHash?: string;
  network: string;
  reason?: string;
}): string {
  return Buffer.from(JSON.stringify(r), 'utf8').toString('base64');
}
