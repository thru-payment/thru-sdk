export type PublicPaymentTransaction = {
  txHash: string;
  amount: string;
  confirmations: number;
  status: string;
};

export type PublicPayment = {
  id: string;
  chain: string;
  network: string;
  token: string;
  currency: string;
  expectedAmount: string;
  receivedAmount: string;
  paymentAddress: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  confirmedAt?: string | null;
  transactions?: PublicPaymentTransaction[];
};

export type PublicPlan = {
  id: string;
  name: string;
  chain: string;
  network: string;
  token: string;
  receivingAddress: string;
  price: string;
  periodSeconds: number;
};

export type PublicSubscription = {
  id: string;
  planId: string;
  status: string;
  expiresAt?: string | null;
  active: boolean;
};
