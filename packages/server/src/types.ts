/** thru's production API base. */
export const DEFAULT_API_BASE_URL = 'https://api.thru.la/v1';

export type CheckoutSessionStatus =
  | 'open'
  | 'processing'
  | 'completed'
  | 'expired'
  | 'cancelled'
  | 'failed';

export type CheckoutSessionSource = 'product' | 'invoice';

/** The outcome a shopper's return carries, and the outcome an event reports. */
export type ReturnOutcome = 'completed' | 'pending' | 'cancelled' | 'expired' | 'failed';

export type CreateCheckoutSessionParams = {
  /** Exactly one source. `productSlug` is what a merchant has in their own catalogue. */
  productSlug?: string;
  productId?: string;
  invoiceId?: string;

  /**
   * YOUR identifier for the customer or order — a user id, an account id, an order number.
   * thru stores it, indexes it, returns it on retrieve and puts it in every event for this
   * session. It is never shown to the shopper and never put in a URL.
   */
  reference?: string;

  /** Arbitrary JSON, returned verbatim. Under 8KB. */
  metadata?: Record<string, unknown>;

  /** Send the same key twice and you get the same session back, never a second one. */
  idempotencyKey?: string;

  /** Where the shopper goes afterwards. Each must be on your registered return origins. */
  returnUrl?: string;
  successUrl?: string;
  cancelUrl?: string;
  expiredUrl?: string;
  failedUrl?: string;
  pendingUrl?: string;

  /** Pin the chain, or omit and let the shopper choose from the ones you enabled. */
  chain?: string;
  locale?: string;
  /** 300 to 604800. Default 1800. Gates redemption only — a started payment keeps its own clock. */
  expiresInSeconds?: number;
};

export type CheckoutSession = {
  id: string;
  object: 'checkout.session';
  /** Send the shopper here. */
  url: string;
  status: CheckoutSessionStatus;
  source: CheckoutSessionSource;
  productId: string | null;
  invoiceId: string | null;
  reference: string | null;
  metadata: Record<string, unknown> | null;
  chain: string | null;
  network: string;
  locale: string | null;
  paymentId: string | null;
  subscriptionId: string | null;
  /** Money arrived after this session was already reported terminal. Grant, and also alert. */
  late: boolean;
  expiresAt: string;
  redeemedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  livemode: boolean;
};

export type ListCheckoutSessionsParams = {
  reference?: string;
  /** One status, or several comma-separated. */
  status?: string;
  productId?: string;
  /** ISO-8601. Walk forward from a watermark to reconcile anything a webhook dropped. */
  createdAfter?: string;
  limit?: number;
  cursor?: string;
};

export type CheckoutSessionList = {
  data: CheckoutSession[];
  hasMore: boolean;
  nextCursor: string | null;
};

/** The body of every `checkout.session.*` event. Identical for all four, and for all sources. */
export type CheckoutSessionEvent = {
  sessionId: string;
  merchantId: string;
  status: CheckoutSessionStatus;
  /** Your own identifier, exactly as you set it. */
  reference: string | null;
  metadata: Record<string, unknown> | null;
  /** 'server' when thru minted the session for you; 'none' when no reference was set. */
  referenceOrigin: 'server' | 'none';
  source: CheckoutSessionSource;
  kind: 'one_off' | 'subscription';
  productId: string | null;
  productSlug: string | null;
  productName: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  paymentId: string | null;
  subscriptionId: string | null;
  planId: string | null;
  payerAddress: string | null;
  chain: string | null;
  /** Load-bearing: gate on this if your entitlement is mainnet-only. */
  network: string;
  token: string | null;
  /** The on-chain identifier — a contract address, or a Sui coin type. Null for a native asset. */
  tokenAddress: string | null;
  decimals: number | null;
  expectedAmount: string | null;
  /** The same amount in atomic units, computed by thru. Exact; no float involved. */
  expectedAmountAtomic: string | null;
  receivedAmount: string | null;
  receivedAmountAtomic: string | null;
  paymentStatus: string | null;
  txHash: string | null;
  subscriptionExpiresAt: string | null;
  late: boolean;
  completedAt: string | null;
  createdAt: string;
  livemode: boolean;
};

export type ThruEventType =
  | 'checkout.session.completed'
  | 'checkout.session.expired'
  | 'checkout.session.cancelled'
  | 'checkout.session.failed'
  | 'payment.confirmed'
  | 'payment.expired'
  | 'payment.underpaid'
  | 'payment.overpaid'
  | 'subscription.activated'
  | 'subscription.extended'
  | 'subscription.expired';

export type ThruEvent =
  | {
      id: string;
      type:
        | 'checkout.session.completed'
        | 'checkout.session.expired'
        | 'checkout.session.cancelled'
        | 'checkout.session.failed';
      createdAt: string;
      data: CheckoutSessionEvent;
    }
  | {
      id: string;
      type: Exclude<ThruEventType, `checkout.session.${string}`> | (string & {});
      createdAt: string;
      data: Record<string, unknown>;
    };
