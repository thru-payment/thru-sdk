// CANONICAL INTEGRATION EXAMPLE — this file is the source of truth for every `@thru-payment/x402` snippet
// in the docs and the merchant console. It is typechecked in CI (`npm run typecheck:examples`)
// against the package's real exported types, so it cannot drift from the API the way hand-written
// snippets in JSX did. If you change the SDK's surface, this file breaks the build — fix it here
// first, then propagate.
//
// Run: THRU_API_KEY=... npx tsx examples/express-server.ts

import express from 'express';
import { createFacilitatorClient, resolveEvmRoute, resolveSuiRoute, type RouteRequirements } from '@thru-payment/x402';
import { paymentMiddleware } from '@thru-payment/x402/express';
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
const SUI_USDC = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
const ROBINHOOD_USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';

function atomic(human: string, decimals: number): bigint {
  const [whole, frac = ''] = human.split('.');
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}

async function main() {
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
    // `resolveSuiRoute` picks `scheme` for you: `sui_direct` (gasless — no sponsor) when the
    // facilitator advertises it for this asset, `sui_sponsored` (with the sponsor's quoted
    // `gasOwner` already filled into `extra`) otherwise. You never need to know which one a given
    // asset qualifies for, or keep that in sync as more assets become SIP-58-gasless-eligible —
    // that eligibility list is facilitator-internal and can change server-side at any time.
    'GET /reports/quarterly': await resolveSuiRoute(facilitator, {
      chain: 'sui',
      network: 'testnet',
      asset: SUI_USDC,
      amountAtomic: atomic('0.50', 6),
      payTo: process.env.THRU_SUI_SETTLEMENT_ADDRESS!,
      resource: '/reports/quarterly',
      maxTimeoutSeconds: 300,
    }),
    // `resolveEvmRoute` is the same idea for bnb/robinhood: `eip3009_exact` (the token verifies the
    // signature itself — no approve, ever) when the facilitator has confirmed EIP-3009 domain info
    // for this asset, `permit2_exact` (works with any ERC-20, but needs a one-time payer approve)
    // otherwise. Pass `{ allowPermit2: false }` if your payers must never see an approve step.
    'GET /reports/annual': await resolveEvmRoute(facilitator, {
      chain: 'robinhood',
      network: 'mainnet',
      asset: ROBINHOOD_USDG,
      amountAtomic: atomic('5.00', 6),
      payTo: process.env.THRU_ROBINHOOD_SETTLEMENT_ADDRESS!,
      resource: '/reports/annual',
      maxTimeoutSeconds: 300,
    }),
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
  app.get('/reports/quarterly', (_req, res) => {
    res.json({ report: '…' });
  });
  app.get('/reports/annual', (_req, res) => {
    res.json({ report: '…' });
  });

  app.listen(3000);
}

main();
