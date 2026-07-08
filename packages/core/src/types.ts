/** Every chain the thru API understands. */
export const CHAINS = [
  'ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bnb', 'bsc',
  'avalanche', 'fantom', 'gnosis', 'linea', 'scroll', 'zksync', 'mantle',
  'celo', 'blast', 'solana', 'sui', 'aptos', 'tron', 'bitcoin', 'litecoin',
  'dogecoin', 'xrp', 'ton', 'near', 'cosmos', 'polkadot', 'cardano',
] as const;
export type Chain = (typeof CHAINS)[number];

export const NETWORKS = ['mainnet', 'testnet'] as const;
export type Network = (typeof NETWORKS)[number];

export type PaymentStatus =
  | 'created' | 'waiting_for_payment' | 'detected' | 'confirming' | 'confirmed'
  | 'settled' | 'expired' | 'underpaid' | 'overpaid' | 'failed' | 'refunded';

export type RefundStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type WithdrawalStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'rejected';
export type SettlementStatus = 'active' | 'pending_change';
export type SweepStatus = 'pending' | 'funding_gas' | 'sweeping' | 'completed' | 'failed' | 'skipped';
export type DirectPayPlanStatus = 'active' | 'archived';
export type SubscriptionStatus = 'pending' | 'active' | 'expired';
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void';
export type ProductKind = 'one_off' | 'subscription';
export type ProductStatus = 'active' | 'archived';
export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
export type VerificationLevel = 'kyc' | 'kyb';
export type ScreeningDecision = 'pass' | 'review' | 'block';
export type ComplianceCaseStatus = 'open' | 'in_review' | 'resolved' | 'dismissed';
export type EscrowState = 'locked' | 'released' | 'refunded' | 'disputed';
export type FacilitatorProtocol = 'x402' | 'mpp';
export type FacilitatorScheme = 'permit2_exact' | 'sui_sponsored';
export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type WorkspacePlan = 'free' | 'team' | 'enterprise';
export type LabelType =
  | 'contract' | 'mixer' | 'hacker' | 'defi' | 'exchange' | 'bridge'
  | 'scam' | 'sanctioned' | 'wallet' | 'token' | 'other';
export type EventSourceStatus = 'active' | 'paused' | 'error';

/** Arbitrary JSON metadata attached to a resource. */
export type Metadata = Record<string, unknown>;

/** A decimal amount as a string (never a float — avoids precision loss). */
export type Decimal = string;
