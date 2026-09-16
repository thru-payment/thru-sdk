/**
 * @thru-payment/server — the server side of thru.
 *
 * Three jobs, and nothing else:
 *   1. create a hosted checkout session carrying YOUR customer reference, and get its URL;
 *   2. verify the shopper when they come back, per outcome;
 *   3. verify the webhook, which is what tells you about the shoppers who never came back.
 *
 * Web Crypto only — no node:crypto, no Buffer — so it runs unchanged on Node 20+, Cloudflare
 * Workers, Deno and Bun. There is no browser build: this package holds an API key.
 */
export { createThruServerClient, ThruApiError } from './client.js';
export type { ThruServerClient, ThruServerClientOptions } from './client.js';

export {
  DEFAULT_RETURN_TOLERANCE_SECONDS,
  RETURN_PARAM_SESSION,
  RETURN_PARAM_SIGNATURE,
  RETURN_PARAM_STATUS,
  RETURN_PARAM_TIMESTAMP,
  verifyThruReturn,
} from './return.js';
export type { VerifiedReturn, VerifyReturnOptions } from './return.js';

export {
  constructThruEvent,
  isCheckoutSessionEvent,
  EVENT_TYPE_HEADER,
  SIGNATURE_HEADER,
  ThruSignatureError,
} from './webhooks.js';

export { hmacHex, safeEqualHex } from './hmac.js';

export { DEFAULT_API_BASE_URL } from './types.js';
export type {
  CheckoutSession,
  CheckoutSessionEvent,
  CheckoutSessionList,
  CheckoutSessionSource,
  CheckoutSessionStatus,
  CreateCheckoutSessionParams,
  ListCheckoutSessionsParams,
  ReturnOutcome,
  ThruEvent,
  ThruEventType,
} from './types.js';
