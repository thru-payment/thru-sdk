// Shared wire-facing types for the `@thru-payment/x402` merchant SDK.
//
// This package never depends on `apps/api` code — the shared contract is the wire format itself
// (spec §8 / plan Task 10). Field names here intentionally mirror
// `apps/api/src/facilitator/protocols/normalized.types.ts` and the x402/mpp codecs so the two
// implementations stay aligned, but there is no import relationship between them.

export type Protocol = 'x402' | 'mpp';
export type Scheme = 'permit2_exact' | 'eip3009_exact' | 'sui_sponsored' | 'sui_direct';
export type Chain = 'bnb' | 'robinhood' | 'sui';
export type Network = 'mainnet' | 'testnet';

/** What a merchant route charges — the SDK-side counterpart of `PaymentRequirements`. */
export interface RouteRequirements {
  scheme: Scheme;
  chain: Chain;
  network: Network;
  asset: string; // token address / coin type
  amountAtomic: bigint;
  payTo: string; // merchant settlement address
  resource: string; // URL or logical id of the paid resource
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

/** Body shared by `/v1/facilitator/verify` and `/v1/facilitator/settle` (spec §7). */
export interface FacilitatorRequestBody {
  protocol: Protocol;
  paymentPayload: string; // x402: base64(JSON) envelope. mpp: the raw `Authorization: Payment` header value.
  paymentRequirements: string; // base64(JSON) `PaymentRequirements`, as produced by encodeRequirements()
}

export interface VerifyResponseBody {
  valid: boolean;
  reason?: string;
  payer?: string;
}

export interface SettleResponseBody {
  success: boolean;
  txHash?: string;
  reason?: string;
  paymentId?: string;
  /**
   * Whether the facilitator actually submitted a transaction — a hard guarantee, not a best-effort
   * guess (mirrors `apps/api/.../protocols/normalized.types.ts#SettleResult.settlementState`).
   * `not_broadcast` means nothing was sent, full stop — the ONLY condition under which resubmitting
   * the same authorization through another path (see `./payer.js`'s `settleWithPayerGas` for
   * `eip3009_exact`) is safe. Treat `broadcast` and an absent value identically: never assume it's
   * safe to resubmit.
   */
  settlementState?: 'not_broadcast' | 'broadcast';
}

export interface SupportedAssetBnb {
  address: string;
  symbol: string;
  decimals: number;
  maxPaymentAtomic: string;
  /** Present only under an `eip3009_exact` kind — the token's own EIP-712 domain identity, needed
   * to construct a valid `TransferWithAuthorization` signature. Per-asset, not per-kind, because
   * each token contract defines its own `name`/`version`. */
  eip3009?: { name: string; version: string };
}

export interface SupportedAssetSui {
  coinType: string;
  symbol: string;
  decimals: number;
  maxPaymentAtomic: string;
}

/**
 * How a client may get a signed authorization onto the chain (mirrors
 * `apps/api/.../facilitator-public.controller.ts#SettlementMode`). `facilitator_broadcast` is
 * always available when a kind is advertised at all. `payer_broadcast_fallback` — the payer's own
 * wallet can submit the SAME already-signed authorization directly, no relayer involved — only
 * ever appears for `eip3009_exact`: unlike Permit2 (whose signed `spender` field IS checked
 * against `msg.sender` on-chain, so only Thru's relayer can ever submit one), an EIP-3009
 * signature isn't bound to a specific submitter. See `./payer.js`'s `settleWithPayerGas`.
 */
export type SettlementMode = 'facilitator_broadcast' | 'payer_broadcast_fallback';

export interface SupportedKind {
  protocol: Protocol;
  scheme: Scheme;
  chain: Chain;
  network: Network;
  assets: Array<SupportedAssetBnb | SupportedAssetSui>;
  /** Absent on older facilitator versions — treat as `['facilitator_broadcast']` if so. */
  settlementModes?: SettlementMode[];
  extra: {
    spender?: string | null;
    gasOwner?: string | null;
    /**
     * Whether the relayer this kind depends on can currently afford one more settle — read live,
     * not cached, so a client can check readiness *before* asking a payer to sign anything rather
     * than only discovering `gas_tank_empty` after a failed settle(). Only ever present on the EVM
     * kinds (permit2_exact/eip3009_exact); absent means "not tracked for this kind" (e.g. the Sui
     * kinds), not "not ready" — check for `=== false` specifically, not falsiness.
     */
    gasReady?: boolean;
  };
}

export interface SupportedKinds {
  kinds: SupportedKind[];
}
