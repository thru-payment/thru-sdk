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
