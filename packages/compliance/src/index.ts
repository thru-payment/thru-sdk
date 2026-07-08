import {
  HttpClient,
  Resource,
  type Chain,
  type ComplianceCaseStatus,
  type EscrowState,
  type KycStatus,
  type Network,
  type ScreeningDecision,
  type ThruClientOptions,
  type VerificationLevel,
} from '@thru/sdk-core';

/* ------------------------------ Compliance -------------------------------- */

export interface ComplianceProfile {
  kycStatus: KycStatus;
  kybStatus: KycStatus;
  riskTier?: string | null;
  businessName?: string | null;
  notes?: string | null;
}

export interface ComplianceOverview {
  profile: ComplianceProfile;
  screeningsCount: number;
  openCases: number;
}

export interface UpdateProfileParams {
  kycStatus?: KycStatus;
  kybStatus?: KycStatus;
  riskTier?: string;
  businessName?: string;
  notes?: string;
}

export interface Screening {
  id: string;
  chain: Chain;
  address: string;
  decision: ScreeningDecision;
  risk?: number | null;
  reasons?: string[];
  createdAt: string;
}

export interface ComplianceCase {
  id: string;
  type: string;
  status: ComplianceCaseStatus;
  assignee?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface UpdateCaseParams {
  status?: ComplianceCaseStatus;
  assignee?: string;
  notes?: string;
}

export class Compliance extends Resource {
  readonly kyc = new Kyc(this.http);

  overview(): Promise<ComplianceOverview> {
    return this.http.get<ComplianceOverview>('/compliance');
  }
  updateProfile(params: UpdateProfileParams): Promise<ComplianceProfile> {
    return this.http.patch<ComplianceProfile>('/compliance/profile', params);
  }
  /** Screen an address for sanctions / mixer / high-risk exposure. */
  screen(params: { chain: Chain; address: string }): Promise<Screening> {
    return this.http.post<Screening>('/compliance/screen', params);
  }
  listScreenings(): Promise<Screening[]> {
    return this.http.get<Screening[]>('/compliance/screenings');
  }
  listCases(params: { status?: ComplianceCaseStatus } = {}): Promise<ComplianceCase[]> {
    return this.http.get<ComplianceCase[]>('/compliance/cases', { query: { ...params } });
  }
  updateCase(id: string, params: UpdateCaseParams): Promise<ComplianceCase> {
    return this.http.patch<ComplianceCase>(`/compliance/cases/${encodeURIComponent(id)}`, params);
  }
}

/* --------------------------------- KYC ------------------------------------ */

export interface Verification {
  id: string;
  level: VerificationLevel;
  status: KycStatus;
  subject?: string | null;
  provider?: string | null;
  createdAt: string;
}

export interface KycOverview {
  verifications: Verification[];
  provider: { name: string; configured: boolean };
}

export class Kyc extends Resource {
  list(): Promise<KycOverview> {
    return this.http.get<KycOverview>('/compliance/kyc');
  }
  start(params: { level: VerificationLevel; subject?: string }): Promise<Verification> {
    return this.http.post<Verification>('/compliance/kyc/start', params);
  }
  decide(
    id: string,
    params: { status: KycStatus; reason?: string },
  ): Promise<Verification> {
    return this.http.post<Verification>(`/compliance/kyc/${encodeURIComponent(id)}/decision`, params);
  }
}

/* -------------------------------- Escrow ---------------------------------- */

export interface Escrow {
  id: string;
  objectId: string;
  chain: Chain;
  network: Network;
  state: EscrowState;
  payer?: string | null;
  payee?: string | null;
  arbiter?: string | null;
  amount?: string | null;
  createdAt: string;
}

export interface EscrowConfig {
  packageId?: string | null;
  network: Network;
  configured: boolean;
}

export class Escrows extends Resource {
  list(): Promise<{ escrows: Escrow[]; config: EscrowConfig }> {
    return this.http.get('/escrow');
  }
  /** Record an on-chain escrow object so thru tracks its state. */
  record(params: { objectId: string }): Promise<Escrow> {
    return this.http.post<Escrow>('/escrow', params);
  }
  refresh(id: string): Promise<Escrow> {
    return this.http.post<Escrow>(`/escrow/${encodeURIComponent(id)}/refresh`);
  }
}

/** Standalone client bundling every compliance resource. */
export function createComplianceClient(options: ThruClientOptions) {
  const http = new HttpClient(options);
  return {
    http,
    compliance: new Compliance(http),
    kyc: new Kyc(http),
    escrow: new Escrows(http),
  };
}
