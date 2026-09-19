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

/**
 * Money, as thru spells it: a decimal STRING, never a number.
 *
 * `"37"`, `"37.5"`, `"37.50"` — digits, optionally a point and at most two more digits. No sign,
 * no exponent, no whitespace, and nothing below `"0.01"`. Two places is the contract because a
 * merchant crediting a user "1:1" is crediting dollars, and dollars stop at cents. It is a string
 * so that 0.1 + 0.2 never happens on a payments rail.
 */
export type DecimalString = string;

/**
 * The bounds a custom-amount product enforces, as the API reports them on the public product and
 * on the 400 it returns for an amount outside them. `minAmount` is the EFFECTIVE minimum — the
 * merchant's own floor, never below thru's `0.01` — so it is the number to show a shopper before
 * they type, not after they transfer.
 */
export type AmountBounds = {
  minAmount: DecimalString;
  maxAmount: DecimalString | null;
  currency: 'USD';
};

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

  /**
   * The amount to charge, in USD, for a product whose `pricingMode` is `custom_amount` — a top-up,
   * a credit purchase, anything where the shopper rather than the catalogue decides the number.
   *
   * REQUIRED on a custom-amount product and REFUSED (400) on a fixed-price one or an invoice, whose
   * price lives on the source. Checked against the product's `minAmount`/`maxAmount`; a range
   * failure is a 400 whose body carries the effective bounds — see `amountBoundsOf`.
   *
   * LOCKED once the session exists. The shopper's page has no amount field, the redeem endpoint
   * rejects one, and no endpoint can change it afterwards. The payment thru mints for the session
   * expects exactly this amount in the stablecoin the shopper picks.
   */
  amount?: DecimalString;

  /**
   * Send the same key twice and you get the same session back, never a second one.
   *
   * "The same" means the same source AND the same `amount` (`"37"` and `"37.00"` agree). A replay
   * that names a different product or amount is a 409, never the stored session handed back as if
   * it matched — so a retried create cannot silently change the order. Return URLs and metadata
   * are not compared.
   */
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
  /**
   * The CURRENTLY bound payment. A session that lets the shopper switch rail can have had several
   * payments over its life, but only this one can receive money that counts toward the session;
   * the others were retired through `payment.expired`.
   */
  paymentId: string | null;
  /**
   * The amount YOU locked at create, for a custom-amount session. Null on a fixed-price product
   * or an invoice, whose price lives on the source. This is what was asked for; it is never what
   * arrived — grant from `receivedAmount`.
   */
  amount: DecimalString | null;
  /** `'USD'` exactly when `amount` is set. */
  currency: 'USD' | null;
  chain: string | null;
  /** Load-bearing: gate on this if your entitlement is mainnet-only. */
  network: string;
  token: string | null;
  /** The on-chain identifier — a contract address, or a Sui coin type. Null for a native asset. */
  tokenAddress: string | null;
  decimals: number | null;
  /**
   * What the bound payment expects, in `token`. Before a payment exists it falls back to `amount`,
   * so the create response of a $37 session already reads `"37"`; once bound it is the payment's
   * own (equal on a custom-amount product; the rail's price on a fixed one).
   */
  expectedAmount: DecimalString | null;
  /**
   * The same amount in atomic units, computed by thru. Exact; no float involved — compare against
   * your own expectation to catch a price that changed on one side and not the other.
   */
  expectedAmountAtomic: string | null;
  /** What has actually arrived at the payment address. Null until a payment exists. */
  receivedAmount: DecimalString | null;
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
 *   your own `reference`. If you sell a FIXED-PRICE product — a plan, an item — and the question is
 *   "did they pay for it?", listen to these ALONE.
 *
 *   `payment.*` is the SPINE. These fire from inside the money path and predate checkout
 *   sessions. They describe the SAME money as the session events. If you sell a CUSTOM-AMOUNT
 *   product — a top-up, credits — and the question is "how much arrived?", listen to these ALONE:
 *   they fire on every status transition (`underpaid` → `confirmed` as a top-up lands), and since
 *   0.3.0 they carry `checkoutSession { id, reference, metadata }` so you still know whose money
 *   it is. Subscribing to both families is legitimate for reconciliation, but then you must dedupe
 *   on something other than "an event arrived", because two will.
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

/**
 * A payment's status, as the `status` column spells it.
 *
 * The ones a crediting backend acts on: `confirmed` and `overpaid` (grant), `underpaid` (grant
 * what arrived, if you credit per unit; a top-up keeps raising `receivedAmount` and re-fires the
 * event when the status moves), `refunded`. `expired` is a display state, not a close: a transfer
 * to the address is still credited during the late grace, and reported as `late`.
 */
export type PaymentStatus =
  | 'created'
  | 'waiting_for_payment'
  | 'detected'
  | 'confirming'
  | 'confirmed'
  | 'settled'
  | 'expired'
  | 'underpaid'
  | 'overpaid'
  | 'failed'
  | 'refunded';

/**
 * The checkout session a payment belongs to, projected to the three fields you correlate on.
 *
 * This is what lets you subscribe to `payment.*` ALONE and still know which of YOUR orders the
 * money is for: the session carries your `reference`, the payment carries the money, and one event
 * carries both. `GET /v1/payments/:id` carries the same three fields under the same key.
 */
export type PaymentCheckoutSessionRef = {
  id: string;
  /** Your own identifier, exactly as you set it at create. */
  reference: string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * A payment, as `GET /v1/payments/:id` returns it and as every `payment.*` event carries it.
 *
 * THE THREE AMOUNTS — the whole crediting contract is which one you read:
 *   `expectedAmount`  what was asked for (a session's `amount`, or the rail's price);
 *   `receivedAmount`  what has ARRIVED — cumulative, the sum of every transfer to the address,
 *                     so an underpayment topped up later reads the total. Grant from this;
 *   `feeAmount`       thru's platform fee on the row (`feeBps` is the rate).
 * `token` is the stablecoin the shopper paid in and `currency` is that same symbol; the amounts
 * are in it. Every amount is a decimal string, never a number.
 *
 * No threshold hides a small receipt: any detected transfer is added to `receivedAmount` and
 * reported as `underpaid` until it reaches `expectedAmount`.
 */
export type Payment = {
  id: string;
  merchantId: string;
  chain: string;
  /** Load-bearing: gate on this if your entitlement is mainnet-only. */
  network: string;
  token: string;
  amount: DecimalString;
  currency: string;
  expectedAmount: DecimalString;
  receivedAmount: DecimalString;
  feeBps: number;
  feeAmount: DecimalString;
  paymentAddress: string;
  status: PaymentStatus;
  idempotencyKey: string | null;
  /** `metadata.thru.sessionId` names the session even on a payment that is no longer bound to it. */
  metadata: Record<string, unknown> | null;
  productId: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  /**
   * The session this payment is bound to; null when it was never part of one, or when the session
   * moved on to another rail (then `metadata.thru.sessionId` still names it — treat any money on
   * such a payment as a stray to reconcile by hand). Only the single read carries it; the list
   * endpoint does not.
   */
  checkoutSession: PaymentCheckoutSessionRef | null;
};

/** The on-chain transfer that moved a payment, as `payment.*` events carry it. */
export type BlockchainTransaction = {
  id: string;
  paymentId: string;
  merchantId: string;
  chain: string;
  network: string;
  txHash: string;
  logIndex: number;
  fromAddress: string;
  toAddress: string;
  tokenAddress: string | null;
  amount: DecimalString;
  /** A string: block numbers can exceed 2^53 and are serialised as such. */
  blockNumber: string;
  confirmations: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * The body of `payment.confirmed`, `payment.underpaid`, `payment.overpaid` and
 * `payment.refunded`.
 *
 * `checkoutSession` is present when the payment is bound to a session and ABSENT — not null —
 * otherwise, so a receiver written before sessions existed sees exactly the shape it always did.
 * `payment` here is the row as it was when the event was written; re-read it with
 * `thru.payments.retrieve` before granting, because a top-up can have landed since.
 */
export type PaymentEventData = {
  merchantId: string;
  eventType: `payment.${string}`;
  payment: Omit<Payment, 'checkoutSession'>;
  blockchainTransaction: BlockchainTransaction | null;
  checkoutSession?: PaymentCheckoutSessionRef;
};

/**
 * The body of `payment.expired`. Flat, and older than the others: it carries the quote that
 * lapsed, not a payment object. A session that switches rail retires its previous payment through
 * this same event, with `checkoutSession` naming the session it was minted for.
 */
export type PaymentExpiredEventData = {
  paymentId: string;
  chain: string;
  network: string;
  token: string;
  expectedAmount: DecimalString;
  expiresAt: string;
  checkoutSession?: PaymentCheckoutSessionRef;
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

export type CheckoutSessionEventType = Extract<ThruEventType, `checkout.session.${string}`>;
export type PaymentEventType = Extract<ThruEventType, `payment.${string}`>;

export type ThruEvent =
  | {
      id: string;
      type: CheckoutSessionEventType;
      createdAt: string;
      data: CheckoutSessionEvent;
    }
  | {
      id: string;
      type: Exclude<PaymentEventType, 'payment.expired'>;
      createdAt: string;
      data: PaymentEventData;
    }
  | {
      id: string;
      type: 'payment.expired';
      createdAt: string;
      data: PaymentExpiredEventData;
    }
  | {
      id: string;
      type: Exclude<ThruEventType, `checkout.session.${string}` | `payment.${string}`> | (string & {});
      createdAt: string;
      data: Record<string, unknown>;
    };
