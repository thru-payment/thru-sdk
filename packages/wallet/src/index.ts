import {
  HttpClient,
  Resource,
  type Decimal,
  type ThruClientOptions,
} from '@thru/sdk-core';

/* -------------------------------- Wallet ---------------------------------- */

export interface WalletBalance {
  token: string;
  chain: string;
  network: string;
  amount: Decimal;
}

export interface WalletOverview {
  tier: 'personal' | 'merchant' | 'enterprise';
  balances: WalletBalance[];
  capabilities: Record<string, boolean>;
  agent: { enabled: boolean; quota?: number | null };
}

export class Wallet extends Resource {
  /** The workspace wallet overview: balances, capabilities and agent quota. */
  retrieve(): Promise<WalletOverview> {
    return this.http.get<WalletOverview>('/wallet');
  }
}

/* ---------------------------------- MPC ----------------------------------- */

export type MpcWalletPurpose = 'treasury' | 'sponsor' | 'custom';

export interface MpcWallet {
  id: string;
  name: string;
  purpose: MpcWalletPurpose;
  address: string;
  publicKey: string;
  participants: number;
  threshold: number;
  createdAt: string;
}

export interface MpcOverview {
  wallets: MpcWallet[];
  provider: { name: string; online: boolean };
}

export interface CreateMpcWalletParams {
  name: string;
  purpose?: MpcWalletPurpose;
  /** Number of key-share participants (2-9). */
  participants?: number;
  /** Signatures required to sign (2-9, <= participants). */
  threshold?: number;
}

export class Mpc extends Resource {
  overview(): Promise<MpcOverview> {
    return this.http.get<MpcOverview>('/mpc');
  }
  /** Create an MPC wallet via distributed key generation (owner/admin only). */
  createWallet(params: CreateMpcWalletParams): Promise<MpcWallet> {
    return this.http.post<MpcWallet>('/mpc/wallets', params);
  }
  getWallet(id: string): Promise<MpcWallet> {
    return this.http.get<MpcWallet>(`/mpc/wallets/${encodeURIComponent(id)}`);
  }
}

/** Standalone client bundling wallet + MPC resources. */
export function createWalletClient(options: ThruClientOptions) {
  const http = new HttpClient(options);
  return { http, wallet: new Wallet(http), mpc: new Mpc(http) };
}
