import {
  HttpClient,
  Resource,
  type ThruClientOptions,
  type WorkspacePlan,
  type WorkspaceRole,
} from '@thru/sdk-core';

/* -------------------------------- Account --------------------------------- */

export interface Account {
  id: string;
  name: string;
  type: 'personal' | 'organization';
  plan: WorkspacePlan;
  role: WorkspaceRole;
  status: string;
}

export class AccountResource extends Resource {
  /** The workspace + account the current credentials belong to. */
  retrieve(): Promise<Account> {
    return this.http.get<Account>('/merchants/me');
  }
}

/* -------------------------------- API keys -------------------------------- */

export interface ApiKey {
  id: string;
  name?: string | null;
  prefix: string;
  status: 'active' | 'revoked';
  lastUsedAt?: string | null;
  createdAt: string;
}

/** A newly created key — `key` is the raw secret, shown only once. */
export interface CreatedApiKey extends ApiKey {
  key: string;
}

export class ApiKeys extends Resource {
  list(): Promise<ApiKey[]> {
    return this.http.get<ApiKey[]>('/api-keys');
  }
  /** Create a key. The raw `key` is returned once — store it securely. */
  create(params: { name?: string } = {}): Promise<CreatedApiKey> {
    return this.http.post<CreatedApiKey>('/api-keys', params);
  }
  revoke(id: string): Promise<void> {
    return this.http.delete<void>(`/api-keys/${encodeURIComponent(id)}`);
  }
}

/* ------------------------------- Webhooks --------------------------------- */

export interface WebhookEndpoint {
  id: string;
  url: string;
  status: string;
  createdAt: string;
}

/** A newly created endpoint — `secret` is used to verify signatures. */
export interface CreatedWebhookEndpoint extends WebhookEndpoint {
  secret: string;
}

export interface WebhookEventLog {
  id: string;
  type: string;
  status: 'pending' | 'retrying' | 'delivered' | 'failed';
  attempts: number;
  createdAt: string;
  deliveredAt?: string | null;
}

export class WebhookEndpoints extends Resource {
  /** Register a delivery endpoint. Keep the returned `secret` to verify signatures. */
  create(params: { url: string }): Promise<CreatedWebhookEndpoint> {
    return this.http.post<CreatedWebhookEndpoint>('/webhooks', params);
  }
  list(): Promise<WebhookEndpoint[]> {
    return this.http.get<WebhookEndpoint[]>('/webhooks');
  }
  /** Recent delivered/attempted events (last 100). */
  events(): Promise<WebhookEventLog[]> {
    return this.http.get<WebhookEventLog[]>('/webhooks/events');
  }
}

/* ------------------------------ Workspaces -------------------------------- */

export interface Workspace {
  id: string;
  name: string;
  type: 'personal' | 'organization';
  plan: WorkspacePlan;
  role: WorkspaceRole;
}

export interface Entitlements {
  plan: WorkspacePlan;
  maxMembers: number;
  seatsUsed: number;
  features: string[];
}

/**
 * Workspace management. Most mutations require a dashboard session cookie
 * (not an API key), since an API key is always scoped to one workspace.
 */
export class Workspaces extends Resource {
  list(): Promise<Workspace[]> {
    return this.http.get<Workspace[]>('/workspaces');
  }
  entitlements(): Promise<Entitlements> {
    return this.http.get<Entitlements>('/workspaces/entitlements');
  }
  create(params: { name: string; plan?: WorkspacePlan }): Promise<Workspace> {
    return this.http.post<Workspace>('/workspaces', params);
  }
  switch(id: string): Promise<{ ok: true }> {
    return this.http.post<{ ok: true }>(`/workspaces/${encodeURIComponent(id)}/switch`);
  }
  updateCurrent(params: { name?: string; plan?: WorkspacePlan }): Promise<Workspace> {
    return this.http.patch<Workspace>('/workspaces/current', params);
  }
  deleteCurrent(): Promise<void> {
    return this.http.delete<void>('/workspaces/current');
  }
}

/* -------------------------------- Members --------------------------------- */

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
}

export interface Invitation {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  /** Shareable link when the workspace has no email provider configured. */
  inviteUrl?: string | null;
  createdAt: string;
}

export class Members extends Resource {
  list(): Promise<Member[]> {
    return this.http.get<Member[]>('/members');
  }
  invite(params: { email: string; role: WorkspaceRole }): Promise<Invitation> {
    return this.http.post<Invitation>('/members/invitations', params);
  }
  revokeInvitation(id: string): Promise<void> {
    return this.http.delete<void>(`/members/invitations/${encodeURIComponent(id)}`);
  }
  setRole(userId: string, role: WorkspaceRole): Promise<Member> {
    return this.http.patch<Member>(`/members/${encodeURIComponent(userId)}`, { role });
  }
  remove(userId: string): Promise<void> {
    return this.http.delete<void>(`/members/${encodeURIComponent(userId)}`);
  }
}

/** Standalone client bundling account/developer platform resources. */
export function createPlatformClient(options: ThruClientOptions) {
  const http = new HttpClient(options);
  return {
    http,
    account: new AccountResource(http),
    apiKeys: new ApiKeys(http),
    webhookEndpoints: new WebhookEndpoints(http),
    workspaces: new Workspaces(http),
    members: new Members(http),
  };
}
