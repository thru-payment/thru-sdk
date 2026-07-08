import {
  HttpClient,
  Resource,
  type Chain,
  type FacilitatorProtocol,
  type FacilitatorScheme,
  type Network,
  type ThruClientOptions,
} from '@thru/sdk-core';

export interface FacilitatorRequest {
  protocol: FacilitatorProtocol;
  /** Base64/opaque payment payload from the paying agent. */
  paymentPayload: string;
  /** The payment requirements the resource server advertised. */
  paymentRequirements: string;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string | null;
  payer?: string | null;
}

export interface SettleResult {
  status: 'settling' | 'settled' | 'failed';
  txHash?: string | null;
  paymentId?: string | null;
}

export interface FacilitatorPayment {
  id: string;
  protocol: FacilitatorProtocol;
  scheme: FacilitatorScheme;
  chain: Chain;
  network: Network;
  asset: string;
  amount: string;
  status: 'settling' | 'settled' | 'failed';
  txHash?: string | null;
  createdAt: string;
}

export interface SupportedKind {
  protocol: FacilitatorProtocol;
  scheme: FacilitatorScheme;
  chain: Chain;
  network: Network;
  asset: string;
}

export interface SupportedResponse {
  kinds: SupportedKind[];
  spender?: string | null;
  gasOwner?: string | null;
}

export class Facilitator extends Resource {
  /** Verify a payment envelope without settling it. */
  verify(request: FacilitatorRequest): Promise<VerifyResult> {
    return this.http.post<VerifyResult>('/facilitator/verify', request);
  }
  /** Verify and settle a payment on-chain. */
  settle(request: FacilitatorRequest): Promise<SettleResult> {
    return this.http.post<SettleResult>('/facilitator/settle', request);
  }
  /** List settled/settling facilitator payments. */
  payments(params: { limit?: number; cursor?: string } = {}): Promise<{ data: FacilitatorPayment[]; nextCursor?: string | null }> {
    return this.http.get('/facilitator/payments', { query: { ...params } });
  }
  /** Public discovery of accepted (protocol, scheme, chain, network, asset) kinds. */
  supported(): Promise<SupportedResponse> {
    return this.http.get<SupportedResponse>('/facilitator/supported');
  }
}

/** Standalone facilitator client. */
export function createFacilitatorClient(options: ThruClientOptions) {
  const http = new HttpClient(options);
  return { http, facilitator: new Facilitator(http) };
}
