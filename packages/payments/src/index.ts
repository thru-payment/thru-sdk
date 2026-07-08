import {
  HttpClient,
  Resource,
  type Chain,
  type Decimal,
  type Metadata,
  type Network,
  type PaymentStatus,
  type RefundStatus,
  type SettlementStatus,
  type SweepStatus,
  type ThruClientOptions,
  type WithdrawalStatus,
} from '@thru/sdk-core';

/* ------------------------------- Resources -------------------------------- */

export interface PaymentTransaction {
  txHash: string;
  chain: Chain;
  network: Network;
  fromAddress: string;
  toAddress: string;
  tokenAddress?: string | null;
  amount: Decimal;
  confirmations: number;
  status: string;
  blockNumber?: string | null;
}

export interface Payment {
  id: string;
  chain: Chain;
  network: Network;
  token: string;
  currency: string;
  expectedAmount: Decimal;
  receivedAmount: Decimal;
  feeBps?: number;
  feeAmount?: Decimal;
  paymentAddress: string;
  status: PaymentStatus;
  metadata?: Metadata | null;
  expiresAt: string;
  createdAt: string;
  confirmedAt?: string | null;
  transactions?: PaymentTransaction[];
}

export interface CreatePaymentParams {
  chain: Chain;
  token: string;
  amount: Decimal;
  currency: string;
  network?: Network;
  /** Reuse an existing payment for the same key instead of creating a duplicate. */
  idempotencyKey?: string;
  metadata?: Metadata;
}

export interface ListPaymentsParams {
  status?: PaymentStatus;
  network?: Network;
}

export class Payments extends Resource {
  /** Create a payment and get a chain-aware address to collect to. */
  create(params: CreatePaymentParams): Promise<Payment> {
    return this.http.post<Payment>('/payments', params, { idempotencyKey: params.idempotencyKey });
  }

  retrieve(id: string): Promise<Payment> {
    return this.http.get<Payment>(`/payments/${encodeURIComponent(id)}`);
  }

  list(params: ListPaymentsParams = {}): Promise<Payment[]> {
    return this.http.get<Payment[]>('/payments', { query: { ...params } });
  }

  /** Refund a payment (delegates to the Refunds resource). */
  refund(paymentId: string, params: CreateRefundParams = {}): Promise<Refund> {
    return this.http.post<Refund>(`/payments/${encodeURIComponent(paymentId)}/refund`, params);
  }
}

export interface Refund {
  id: string;
  paymentId: string;
  chain: Chain;
  network: Network;
  token: string;
  amount: Decimal;
  toAddress: string;
  status: RefundStatus;
  reason?: string | null;
  txHash?: string | null;
  createdAt: string;
}

export interface CreateRefundParams {
  /** Defaults to the full remaining refundable amount (net of platform fee). */
  amount?: Decimal;
  reason?: string;
  /** Defaults to the original payer's address. */
  toAddress?: string;
}

export class Refunds extends Resource {
  create(paymentId: string, params: CreateRefundParams = {}): Promise<Refund> {
    return this.http.post<Refund>(`/payments/${encodeURIComponent(paymentId)}/refund`, params);
  }

  list(): Promise<Refund[]> {
    return this.http.get<Refund[]>('/refunds');
  }
}

export interface Withdrawal {
  id: string;
  chain: Chain;
  network: Network;
  token: string;
  amount: Decimal;
  toAddress: string;
  status: WithdrawalStatus;
  txHash?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface WithdrawalChainConfig {
  chain: Chain;
  label: string;
  kind: string;
  support: string;
  nativeToken: string;
  decimals: number;
}

export class Withdrawals extends Resource {
  list(): Promise<Withdrawal[]> {
    return this.http.get<Withdrawal[]>('/withdrawals');
  }

  /** Supported withdrawal chains and their native-token config. */
  config(): Promise<WithdrawalChainConfig[]> {
    return this.http.get<WithdrawalChainConfig[]>('/withdrawals/config');
  }
}

export interface Balance {
  chain: Chain;
  network: Network;
  token: string;
  available: Decimal;
  received: Decimal;
  withdrawn: Decimal;
}

export class Balances extends Resource {
  list(): Promise<Balance[]> {
    return this.http.get<Balance[]>('/balances');
  }
}

export interface SettlementAccount {
  chain: Chain;
  network: Network;
  address: string;
  status: SettlementStatus;
  effectiveAddress: string;
  changePending: boolean;
  pendingAddress?: string | null;
  pendingActivatesAt?: string | null;
}

export interface SetSettlementParams {
  chain: Chain;
  address: string;
  network?: Network;
}

export class Settlement extends Resource {
  list(): Promise<SettlementAccount[]> {
    return this.http.get<SettlementAccount[]>('/settlement');
  }

  /** Set (or stage a change to) the address funds settle to for a chain. */
  set(params: SetSettlementParams): Promise<SettlementAccount> {
    return this.http.put<SettlementAccount>('/settlement', params);
  }

  cancelPending(params: { chain: Chain; network?: Network }): Promise<SettlementAccount> {
    return this.http.post<SettlementAccount>('/settlement/cancel', params);
  }
}

export interface Sweep {
  id: string;
  paymentId: string;
  chain: Chain;
  network: Network;
  token: string;
  fromAddress: string;
  toAddress: string;
  amount: Decimal;
  status: SweepStatus;
  txHash?: string | null;
  error?: string | null;
  createdAt: string;
}

export class Sweeps extends Resource {
  list(): Promise<Sweep[]> {
    return this.http.get<Sweep[]>('/sweeps');
  }
}

export interface Transaction {
  id: string;
  paymentId?: string | null;
  chain: Chain;
  network: Network;
  txHash: string;
  fromAddress: string;
  toAddress: string;
  tokenAddress?: string | null;
  amount: Decimal;
  confirmations: number;
  status: string;
  createdAt: string;
}

export class Transactions extends Resource {
  list(): Promise<Transaction[]> {
    return this.http.get<Transaction[]>('/transactions');
  }
}

/** Standalone client bundling every money-movement resource. */
export function createPaymentsClient(options: ThruClientOptions) {
  const http = new HttpClient(options);
  return {
    http,
    payments: new Payments(http),
    refunds: new Refunds(http),
    withdrawals: new Withdrawals(http),
    balances: new Balances(http),
    settlement: new Settlement(http),
    sweeps: new Sweeps(http),
    transactions: new Transactions(http),
  };
}
