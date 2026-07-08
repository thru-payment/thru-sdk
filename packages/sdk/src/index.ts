import { HttpClient, type ThruClientOptions } from '@thru/sdk-core';
import {
  Balances,
  Payments,
  Refunds,
  Settlement,
  Sweeps,
  Transactions,
  Withdrawals,
} from '@thru/payments';
import { Invoices, Plans, Products, Subscriptions } from '@thru/billing';
import { Compliance, Escrows, Kyc } from '@thru/compliance';
import { Mpc, Wallet } from '@thru/wallet';
import {
  AccountResource,
  ApiKeys,
  Members,
  WebhookEndpoints,
  Workspaces,
} from '@thru/platform';
import { Facilitator } from '@thru/facilitator';
import { Intelligence } from '@thru/intelligence';

/**
 * The official thru client — one typed entry point for the whole API.
 *
 * ```ts
 * import { Thru } from 'thru-sdk';
 * const thru = new Thru({ apiKey: process.env.THRU_API_KEY });
 * const payment = await thru.payments.create({
 *   chain: 'base', token: 'USDC', amount: '25.00', currency: 'USD',
 * });
 * ```
 *
 * Each resource is also available as its own small package (e.g. `@thru/payments`)
 * if you only need part of the surface.
 */
export class Thru {
  /** The shared transport. Use it for endpoints not yet wrapped by a resource. */
  readonly http: HttpClient;

  // Money movement
  readonly payments: Payments;
  readonly refunds: Refunds;
  readonly withdrawals: Withdrawals;
  readonly balances: Balances;
  readonly settlement: Settlement;
  readonly sweeps: Sweeps;
  readonly transactions: Transactions;

  // Billing
  readonly products: Products;
  readonly invoices: Invoices;
  readonly subscriptions: Subscriptions;
  readonly plans: Plans;

  // Trust
  readonly compliance: Compliance;
  readonly kyc: Kyc;
  readonly escrow: Escrows;

  // Accounts + custody
  readonly wallet: Wallet;
  readonly mpc: Mpc;

  // Platform / developer
  readonly account: AccountResource;
  readonly apiKeys: ApiKeys;
  readonly webhookEndpoints: WebhookEndpoints;
  readonly workspaces: Workspaces;
  readonly members: Members;

  // Agent payments + intelligence
  readonly facilitator: Facilitator;
  readonly intelligence: Intelligence;

  constructor(options: ThruClientOptions = {}) {
    this.http = new HttpClient(options);

    this.payments = new Payments(this.http);
    this.refunds = new Refunds(this.http);
    this.withdrawals = new Withdrawals(this.http);
    this.balances = new Balances(this.http);
    this.settlement = new Settlement(this.http);
    this.sweeps = new Sweeps(this.http);
    this.transactions = new Transactions(this.http);

    this.products = new Products(this.http);
    this.invoices = new Invoices(this.http);
    this.subscriptions = new Subscriptions(this.http);
    this.plans = new Plans(this.http);

    this.compliance = new Compliance(this.http);
    this.kyc = new Kyc(this.http);
    this.escrow = new Escrows(this.http);

    this.wallet = new Wallet(this.http);
    this.mpc = new Mpc(this.http);

    this.account = new AccountResource(this.http);
    this.apiKeys = new ApiKeys(this.http);
    this.webhookEndpoints = new WebhookEndpoints(this.http);
    this.workspaces = new Workspaces(this.http);
    this.members = new Members(this.http);

    this.facilitator = new Facilitator(this.http);
    this.intelligence = new Intelligence(this.http);
  }
}

export default Thru;

// Re-export the full surface so `import { Payment, ThruAPIError, verifyWebhookSignature } from 'thru-sdk'` works.
export * from '@thru/sdk-core';
export * from '@thru/payments';
export * from '@thru/billing';
export * from '@thru/compliance';
export * from '@thru/wallet';
export * from '@thru/platform';
export * from '@thru/facilitator';
export * from '@thru/intelligence';
