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
  productId: string | null;
  productSlug: string | null;
  productName: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  paymentId: string | null;
  chain: string | null;
  /** Load-bearing: gate on this if your entitlement is mainnet-only. */
  network: string;
  token: string | null;
  /** The on-chain identifier — a contract address, or a Sui coin type. Null for a native asset. */
  tokenAddress: string | null;
  decimals: number | null;
  expectedAmount: string | null;
  /**
   * The same amount in atomic units, computed by thru. Exact; no float involved — compare against
   * your own expectation to catch a price that changed on one side and not the other.
   */
  expectedAmountAtomic: string | null;
  receivedAmount: string | null;
  receivedAmountAtomic: string | null;
  paymentStatus: string | null;
  txHash: string | null;
  late: boolean;
  completedAt: string | null;
  createdAt: string;
  livemode: boolean;
};

/**
 * Every event thru emits today.
 *
 * WHICH ONES TO LISTEN TO — the question that decides whether you credit a sale twice:
 *
 *   `checkout.session.*` is the CORRELATION layer. One shape for products and invoices, carrying
 *   your own `reference`. If you send customers to thru's hosted page, listen to these ALONE.
 *
 *   `payment.*` is the SPINE. These fire from inside the money path and predate checkout
 *   sessions. They describe the SAME money as the session events — subscribing to both is
 *   legitimate for reconciliation, but then you must dedupe on something other than "an event
 *   arrived", because two will.
 *
 *   `settlement.*` is a different question entirely: when the money reached YOUR wallet, which is
 *   minutes after the customer's transfer confirmed. Useful for treasury reconciliation, never as
 *   the signal to grant access.
 */

/**
 * A checkout session, as `retrieve` and `list` return it.
 *
 * This is a SUPERSET of `CheckoutSessionEvent` — the API builds both from one function, so every
 * field you can read off a webhook you can also read off a retrieve, spelled identically. That
 * means one mapper: `grant(session)` and `grant(event.data)` take the same object.
 *
 * It was not always true. Until 0.1.1 `retrieve` returned a shape of its own, so a return page
 * following thru's own integration guide read fields that were never there.
 */
export type CheckoutSession = CheckoutSessionEvent & {
  id: string;
  object: 'checkout.session';
  /** Send the shopper here. */
  url: string;
  locale: string | null;
  /**
   * When the LINK stops being redeemable.
   *
   * It is not a deadline on the money: once a shopper has redeemed the session and been quoted an
   * address, a transfer to that address is still credited after this passes.
   */
  expiresAt: string;
  redeemedAt: string | null;
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

export type ThruEventType =
  | 'checkout.session.completed'
  | 'checkout.session.expired'
  | 'checkout.session.cancelled'
  | 'checkout.session.failed'
  | 'payment.confirmed'
  | 'payment.expired'
  | 'payment.underpaid'
  | 'payment.overpaid'
  | 'payment.refunded'
  | 'settlement.completed'
  | 'settlement.failed';

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
