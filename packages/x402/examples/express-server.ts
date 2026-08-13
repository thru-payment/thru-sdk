// CANONICAL INTEGRATION EXAMPLE — this file is the source of truth for every `@thru/x402` snippet
// in the docs and the merchant console. It is typechecked in CI (`npm run typecheck:examples`)
// against the package's real exported types, so it cannot drift from the API the way hand-written
// snippets in JSX did. If you change the SDK's surface, this file breaks the build — fix it here
// first, then propagate.
//
// Run: THRU_API_KEY=... npx tsx examples/express-server.ts

import express from 'express';
import { createFacilitatorClient, type RouteRequirements } from '@thru/x402';
import { paymentMiddleware } from '@thru/x402/express';
//       ^ NOTE the subpath. `paymentMiddleware` is NOT exported from the package root — the root
//         entry deliberately carries no Express dependency so the SDK works in WinterCG runtimes.

const facilitator = createFacilitatorClient({
  apiKey: process.env.THRU_API_KEY!,
  // baseUrl defaults to https://api.thru.la — override for a self-hosted or staging facilitator.
});

// Amounts are ATOMIC bigints, not decimal strings. Decimals differ per asset and getting this
// wrong is a 10^12 error, so derive it rather than hand-writing zeros.
const BNB_USDT = '0x55d398326f99059fF775485246999027B3197955';
const BNB_USDT_DECIMALS = 18; // NB: 18 on BNB Chain, unlike USDT's 6 on most other chains.

function atomic(human: string, decimals: number): bigint {
  const [whole, frac = ''] = human.split('.');
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}

// Route keys are `"METHOD /exact/path"`, compared by string equality against Express's `req.path`.
// No params, no wildcards, no prefix matching — `'GET /reports/:id'` will never match.
const routes: Record<string, RouteRequirements> = {
  'GET /reports/monthly': {
    scheme: 'permit2_exact',
    chain: 'bnb',
    network: 'testnet',
    asset: BNB_USDT,
    amountAtomic: atomic('0.10', BNB_USDT_DECIMALS),
    payTo: process.env.THRU_SETTLEMENT_ADDRESS!,
    resource: '/reports/monthly',
    maxTimeoutSeconds: 300,
  },
};

const app = express();

// paymentMiddleware(routes, client, opts?) — THREE POSITIONAL ARGUMENTS.
// It is not an options object. Passing `{ routes, apiKey, baseUrl }` typechecks as `never` here,
// but in plain JS it silently made every route unmatched, so the gate passed all traffic through
// unpaid. That is why this example is compiled.
app.use(
  paymentMiddleware(routes, facilitator, {
    // Optional. Omit unless you serve MPP clients — Thru must hold the same secret to decode the
    // credential, so it comes from your operator. Without it only the x402 challenge is offered.
    mppSecret: process.env.THRU_MPP_SECRET,
  }),
);

app.get('/reports/monthly', (_req, res) => {
  // Only reached once the payment settled. The PAYMENT-RESPONSE header (carrying the txHash) has
  // already been set on the response by the middleware.
  res.json({ report: '…' });
});

app.listen(3000);
