import {
  HttpClient,
  Resource,
  type Chain,
  type LabelType,
  type Metadata,
  type Network,
  type ThruClientOptions,
} from '@thru/sdk-core';

/* ---------------------------- Fund-flow tracing --------------------------- */

export type TraceDirection = 'in' | 'out' | 'both';

export interface TraceParams {
  chain: Chain;
  network: Network;
  address: string;
  direction?: TraceDirection;
  /** Hop depth, 1-4. */
  depth?: number;
  fromMs?: number;
  toMs?: number;
  maxNodes?: number;
  maxEdgesPerNode?: number;
}

export interface GraphNode {
  id: string;
  address: string;
  chain: Chain;
  label?: string | null;
  risk?: number | null;
  [key: string]: unknown;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  amount?: string | null;
  token?: string | null;
  [key: string]: unknown;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class Intelligence extends Resource {
  readonly labels = new Labels(this.http);
  readonly investigations = new Investigations(this.http);
  readonly eventSources = new EventSources(this.http);

  /** Supported / live chains for tracing. */
  chains(): Promise<{ chain: Chain; live: boolean }[]> {
    return this.http.get('/intelligence/chains');
  }
  /** Trace fund flow from a seed address into a graph. */
  trace(params: TraceParams): Promise<Graph> {
    return this.http.post<Graph>('/intelligence/trace', params);
  }
  /** Expand a node in an existing graph. */
  expand(params: TraceParams): Promise<Graph> {
    return this.http.post<Graph>('/intelligence/expand', params);
  }
  address(
    chain: Chain,
    address: string,
    query: { network?: Network; direction?: TraceDirection; fromMs?: number; toMs?: number } = {},
  ): Promise<unknown> {
    return this.http.get(`/intelligence/address/${chain}/${encodeURIComponent(address)}`, { query: { ...query } });
  }
  entity(chain: Chain, address: string, query: { network?: Network } = {}): Promise<unknown> {
    return this.http.get(`/intelligence/entity/${chain}/${encodeURIComponent(address)}`, { query: { ...query } });
  }
}

/* --------------------------------- Labels --------------------------------- */

export interface Label {
  id: string;
  chain: Chain;
  address: string;
  type: LabelType;
  name?: string | null;
  category?: string | null;
  risk?: number | null;
  notes?: string | null;
  metadata?: Metadata | null;
  createdAt: string;
}

export interface CreateLabelParams {
  chain: Chain;
  address: string;
  type: LabelType;
  name?: string;
  category?: string;
  risk?: number;
  notes?: string;
  metadata?: Metadata;
}

export class Labels extends Resource {
  list(query: { chain?: Chain; type?: LabelType } = {}): Promise<Label[]> {
    return this.http.get<Label[]>('/intelligence/labels', { query: { ...query } });
  }
  create(params: CreateLabelParams): Promise<Label> {
    return this.http.post<Label>('/intelligence/labels', params);
  }
  update(id: string, params: Partial<CreateLabelParams>): Promise<Label> {
    return this.http.patch<Label>(`/intelligence/labels/${encodeURIComponent(id)}`, params);
  }
  delete(id: string): Promise<void> {
    return this.http.delete<void>(`/intelligence/labels/${encodeURIComponent(id)}`);
  }
  /** Bulk lookup labels for many addresses → map of address → label. */
  lookup(params: { chain: Chain; addresses: string[] }): Promise<Record<string, Label>> {
    return this.http.post<Record<string, Label>>('/intelligence/labels/lookup', params);
  }
}

/* ----------------------------- Investigations ----------------------------- */

export interface Investigation {
  id: string;
  name: string;
  description?: string | null;
  chain: Chain;
  network: Network;
  seedAddress: string;
  createdAt: string;
  updatedAt: string;
}

export class Investigations extends Resource {
  list(): Promise<Investigation[]> {
    return this.http.get<Investigation[]>('/intelligence/investigations');
  }
  create(params: Record<string, unknown>): Promise<Investigation> {
    return this.http.post<Investigation>('/intelligence/investigations', params);
  }
  retrieve(id: string): Promise<Investigation> {
    return this.http.get<Investigation>(`/intelligence/investigations/${encodeURIComponent(id)}`);
  }
  update(id: string, params: Record<string, unknown>): Promise<Investigation> {
    return this.http.patch<Investigation>(`/intelligence/investigations/${encodeURIComponent(id)}`, params);
  }
  delete(id: string): Promise<void> {
    return this.http.delete<void>(`/intelligence/investigations/${encodeURIComponent(id)}`);
  }
  addAnnotation(id: string, params: Record<string, unknown>): Promise<unknown> {
    return this.http.post(`/intelligence/investigations/${encodeURIComponent(id)}/annotations`, params);
  }
  updateAnnotation(annotationId: string, params: Record<string, unknown>): Promise<unknown> {
    return this.http.patch(`/intelligence/annotations/${encodeURIComponent(annotationId)}`, params);
  }
  deleteAnnotation(annotationId: string): Promise<void> {
    return this.http.delete<void>(`/intelligence/annotations/${encodeURIComponent(annotationId)}`);
  }
}

/* ------------------------------ Event sources ----------------------------- */

export interface EventSource {
  id: string;
  name: string;
  packageId: string;
  module: string;
  eventName: string;
  network: Network;
  status: 'active' | 'paused' | 'error';
  startCheckpoint: string;
  createdAt: string;
}

export interface CreateEventSourceParams {
  name: string;
  packageId: string;
  module: string;
  eventName: string;
  startCheckpoint: string;
  network?: Network;
  storeBcs?: boolean;
}

export class EventSources extends Resource {
  create(params: CreateEventSourceParams): Promise<EventSource> {
    return this.http.post<EventSource>('/intelligence/event-sources', params);
  }
  list(): Promise<EventSource[]> {
    return this.http.get<EventSource[]>('/intelligence/event-sources');
  }
  retrieve(id: string): Promise<EventSource> {
    return this.http.get<EventSource>(`/intelligence/event-sources/${encodeURIComponent(id)}`);
  }
  update(id: string, params: { status?: EventSource['status']; name?: string; storeBcs?: boolean }): Promise<EventSource> {
    return this.http.patch<EventSource>(`/intelligence/event-sources/${encodeURIComponent(id)}`, params);
  }
  delete(id: string): Promise<void> {
    return this.http.delete<void>(`/intelligence/event-sources/${encodeURIComponent(id)}`);
  }
  /** Poll indexed events for a source (public feed, cursor-paginated). */
  events(id: string, query: { after?: string; limit?: number } = {}): Promise<{ events: unknown[]; nextCursor?: string | null }> {
    return this.http.get(`/intelligence/event-sources/${encodeURIComponent(id)}/events`, { query: { ...query } });
  }
}

/** Standalone intelligence client. */
export function createIntelligenceClient(options: ThruClientOptions) {
  const http = new HttpClient(options);
  return { http, intelligence: new Intelligence(http) };
}
