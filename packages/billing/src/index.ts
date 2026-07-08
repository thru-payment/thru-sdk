import {
  HttpClient,
  Resource,
  type Chain,
  type Decimal,
  type DirectPayPlanStatus,
  type InvoiceStatus,
  type Network,
  type ProductKind,
  type ProductStatus,
  type SubscriptionStatus,
  type ThruClientOptions,
} from '@thru/sdk-core';

/* -------------------------------- Products -------------------------------- */

export interface Product {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  kind: ProductKind;
  chain: Chain;
  network: Network;
  token: string;
  price: Decimal;
  receivingAddress?: string | null;
  periodSeconds?: number | null;
  status: ProductStatus;
  createdAt: string;
}

export interface CreateProductParams {
  name: string;
  kind: ProductKind;
  chain: Chain;
  token: string;
  price: Decimal;
  description?: string;
  imageUrl?: string;
  network?: Network;
  /** Required when `kind` is `subscription`. */
  receivingAddress?: string;
  /** Billing period in seconds, for subscription products. */
  periodSeconds?: number;
}

export interface UpdateProductParams {
  name?: string;
  description?: string;
  imageUrl?: string;
  status?: ProductStatus;
}

export class Products extends Resource {
  create(params: CreateProductParams): Promise<Product> {
    return this.http.post<Product>('/products', params);
  }
  list(): Promise<Product[]> {
    return this.http.get<Product[]>('/products');
  }
  retrieve(id: string): Promise<Product> {
    return this.http.get<Product>(`/products/${encodeURIComponent(id)}`);
  }
  update(id: string, params: UpdateProductParams): Promise<Product> {
    return this.http.patch<Product>(`/products/${encodeURIComponent(id)}`, params);
  }
  archive(id: string): Promise<Product> {
    return this.http.post<Product>(`/products/${encodeURIComponent(id)}/archive`);
  }
}

/* -------------------------------- Invoices -------------------------------- */

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitAmount: Decimal;
}

export interface Invoice {
  id: string;
  publicId: string;
  customerName: string;
  customerEmail?: string | null;
  currency: string;
  chain: Chain;
  network: Network;
  token: string;
  lineItems: InvoiceLineItem[];
  total: Decimal;
  memo?: string | null;
  status: InvoiceStatus;
  dueAt?: string | null;
  createdAt: string;
  paymentId?: string | null;
}

export interface CreateInvoiceParams {
  customerName: string;
  chain: Chain;
  token: string;
  lineItems: InvoiceLineItem[];
  customerEmail?: string;
  currency?: string;
  network?: Network;
  memo?: string;
  /** ISO timestamp. */
  dueAt?: string;
}

export interface UpdateInvoiceParams {
  customerName?: string;
  customerEmail?: string;
  lineItems?: InvoiceLineItem[];
  memo?: string;
  dueAt?: string;
}

export class Invoices extends Resource {
  create(params: CreateInvoiceParams): Promise<Invoice> {
    return this.http.post<Invoice>('/invoices', params);
  }
  list(): Promise<Invoice[]> {
    return this.http.get<Invoice[]>('/invoices');
  }
  retrieve(id: string): Promise<Invoice> {
    return this.http.get<Invoice>(`/invoices/${encodeURIComponent(id)}`);
  }
  update(id: string, params: UpdateInvoiceParams): Promise<Invoice> {
    return this.http.patch<Invoice>(`/invoices/${encodeURIComponent(id)}`, params);
  }
  /** Move a draft invoice to `open` (ready to be paid). */
  send(id: string): Promise<Invoice> {
    return this.http.post<Invoice>(`/invoices/${encodeURIComponent(id)}/send`);
  }
  void(id: string): Promise<Invoice> {
    return this.http.post<Invoice>(`/invoices/${encodeURIComponent(id)}/void`);
  }
}

/* ---------------------- Subscriptions (Direct Pay) ------------------------ */

export interface Plan {
  id: string;
  name: string;
  chain: Chain;
  network: Network;
  token: string;
  receivingAddress: string;
  price: Decimal;
  periodSeconds: number;
  status: DirectPayPlanStatus;
  createdAt: string;
}

export interface CreatePlanParams {
  name: string;
  chain: Chain;
  token: string;
  receivingAddress: string;
  price: Decimal;
  periodSeconds: number;
  network?: Network;
}

export interface Subscription {
  id: string;
  planId: string;
  userRef: string;
  payerAddress: string;
  status: SubscriptionStatus;
  expiresAt?: string | null;
  createdAt: string;
}

export interface CreateSubscriptionParams {
  planId: string;
  userRef: string;
  payerAddress: string;
}

export interface Entitlement {
  active: boolean;
  subscription?: Subscription | null;
  expiresAt?: string | null;
}

export class Plans extends Resource {
  create(params: CreatePlanParams): Promise<Plan> {
    return this.http.post<Plan>('/direct-pay/plans', params);
  }
  list(): Promise<Plan[]> {
    return this.http.get<Plan[]>('/direct-pay/plans');
  }
  archive(id: string): Promise<Plan> {
    return this.http.post<Plan>(`/direct-pay/plans/${encodeURIComponent(id)}/archive`);
  }
}

export class Subscriptions extends Resource {
  readonly plans = new Plans(this.http);

  create(params: CreateSubscriptionParams): Promise<Subscription> {
    return this.http.post<Subscription>('/direct-pay/subscriptions', params);
  }
  list(): Promise<Subscription[]> {
    return this.http.get<Subscription[]>('/direct-pay/subscriptions');
  }
  retrieve(id: string): Promise<Subscription> {
    return this.http.get<Subscription>(`/direct-pay/subscriptions/${encodeURIComponent(id)}`);
  }
  /** Check whether a `userRef` currently has an active subscription. */
  entitlement(userRef: string): Promise<Entitlement> {
    return this.http.get<Entitlement>('/direct-pay/entitlement', { query: { userRef } });
  }
}

/** Standalone client bundling every billing resource. */
export function createBillingClient(options: ThruClientOptions) {
  const http = new HttpClient(options);
  return {
    http,
    products: new Products(http),
    invoices: new Invoices(http),
    subscriptions: new Subscriptions(http),
    plans: new Plans(http),
  };
}
