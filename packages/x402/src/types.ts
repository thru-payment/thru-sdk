// Shared wire-facing types for the `@thru-payment/x402` merchant SDK.
//
// This package never depends on `apps/api` code — the shared contract is the wire format itself
// (spec §8 / plan Task 10). Field names here intentionally mirror
// `apps/api/src/facilitator/protocols/normalized.types.ts` and the x402/mpp codecs so the two
// implementations stay aligned, but there is no import relationship between them.

export type Protocol = 'x402' | 'mpp';
export type Scheme = 'permit2_exact' | 'sui_sponsored' | 'sui_direct';
export type Chain = 'bnb' | 'sui';
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
}

export interface SupportedAssetBnb {
  address: string;
  symbol: string;
  decimals: number;
  maxPaymentAtomic: string;
}

export interface SupportedAssetSui {
  coinType: string;
  symbol: string;
  decimals: number;
  maxPaymentAtomic: string;
}

export interface SupportedKind {
  protocol: Protocol;
  scheme: Scheme;
  chain: Chain;
  network: Network;
  assets: Array<SupportedAssetBnb | SupportedAssetSui>;
  extra: { spender?: string | null; gasOwner?: string | null };
}

export interface SupportedKinds {
  kinds: SupportedKind[];
}
