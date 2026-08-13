// Express adapter for the payment gate (spec §8, plan Task 11). Express is an optional peer
// dependency — this file imports only its types, so `@thru-payment/x402` stays usable without Express
// installed (e.g. in the middleware core / WinterCG fetch handler use cases).

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { gateRequest, type GateRequestOptions } from './middleware.js';
import type { FacilitatorClient } from './client.js';
import type { RouteRequirements } from './types.js';

/**
 * Build an Express middleware that gates the given routes behind payment (spec §8).
 *
 * `routes` keys are `"METHOD /path"` (method upper-cased, e.g. `"GET /reports/monthly"`).
 * Requests to unmatched method+path pairs pass through untouched.
 */
export function paymentMiddleware(
  routes: Record<string, RouteRequirements>,
  client: FacilitatorClient,
  opts?: GateRequestOptions,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const routeKey = `${req.method.toUpperCase()} ${req.path}`;
    const route = routes[routeKey];
    if (!route) {
      next();
      return;
    }

    const headers = req.headers as Record<string, string | undefined>;
    const result = await gateRequest(headers, route, client, opts);

    switch (result.kind) {
      case 'challenge': {
        for (const [key, value] of Object.entries(result.headers)) {
          res.set(key, value);
        }
        res.status(result.status).json({ error: 'payment_required' });
        return;
      }
      case 'error': {
        for (const [key, value] of Object.entries(result.headers)) {
          res.set(key, value);
        }
        res.status(result.status).json(result.body);
        return;
      }
      case 'proceed': {
        for (const [key, value] of Object.entries(result.responseHeaders)) {
          res.set(key, value);
        }
        next();
        return;
      }
    }
  };
}
