// EVM scheme auto-selection — the counterpart to sui-routing.ts's `resolveSuiRoute`. A merchant
// pricing a `bnb`/`robinhood` route currently has to know, per asset, whether `eip3009_exact`
// (the token verifies the signature itself — no allowance, gasless from the payer's very first
// payment) or `permit2_exact` (works with any ERC-20, but needs a one-time on-chain approve to
// Permit2) applies. That's facilitator-internal state (which assets an operator has confirmed
// EIP-3009 domain info for), not something a merchant should hardcode or keep in sync.
//
// `resolveEvmRoute` asks the facilitator's own `GET /v1/facilitator/supported` and fills in
// `scheme` — preferring `eip3009_exact` whenever it's advertised for this `(chain, network,
// asset)` — for you. Neither scheme needs anything in `extra` at the route-config level (unlike
// Sui's `sui_sponsored`, which needs `gasOwner`): a payer's own signing code independently queries
// `/supported` for whatever chain-specific data it needs (e.g. the Permit2 spender address).

import type { FacilitatorClient } from './client.js';
import type { Chain, RouteRequirements, Scheme, SupportedAssetBnb, SupportedKind } from './types.js';

export interface ResolveEvmRouteOptions {
  /** Set false to require the gasless EIP-3009 path and reject ineligible assets instead of
   * silently falling back to Permit2 (which needs a payer approve). Default true. */
  allowPermit2?: boolean;
}

function isEvmAsset(a: SupportedAssetBnb | { coinType: string }): a is SupportedAssetBnb {
  return 'address' in a;
}

function findKind(kinds: SupportedKind[], scheme: Scheme, chain: Chain, network: string, asset: string): SupportedKind | undefined {
  return kinds.find(
    (k) =>
      k.protocol === 'x402' &&
      k.scheme === scheme &&
      k.chain === chain &&
      k.network === network &&
      k.assets.some((a) => isEvmAsset(a) && a.address.toLowerCase() === asset.toLowerCase()),
  );
}

/**
 * Resolve a `bnb`/`robinhood` `RouteRequirements` without pinning `scheme` by hand. Prefers
 * `eip3009_exact` (no approve, ever) whenever the facilitator advertises it for this
 * `(chain, network, asset)`; falls back to `permit2_exact` otherwise, unless
 * `allowPermit2: false`.
 *
 * Throws if the facilitator advertises neither scheme for this asset — a real configuration
 * problem (unknown/unsupported asset, or the facilitator is dormant on this chain) that should
 * fail loudly at startup rather than produce a route that will 402 forever.
 */
export async function resolveEvmRoute(
  client: FacilitatorClient,
  route: Omit<RouteRequirements, 'scheme' | 'extra'> & { extra?: Record<string, unknown> },
  opts?: ResolveEvmRouteOptions,
): Promise<RouteRequirements> {
  const { kinds } = await client.supported();
  const allowPermit2 = opts?.allowPermit2 ?? true;

  const eip3009 = findKind(kinds, 'eip3009_exact', route.chain, route.network, route.asset);
  if (eip3009) {
    return { ...route, scheme: 'eip3009_exact', extra: { ...route.extra } };
  }

  if (allowPermit2) {
    const permit2 = findKind(kinds, 'permit2_exact', route.chain, route.network, route.asset);
    if (permit2) {
      return { ...route, scheme: 'permit2_exact', extra: { ...route.extra } };
    }
  }

  throw new Error(
    `No eligible EVM settlement scheme for asset ${route.asset} on ${route.chain}:${route.network}` +
      (allowPermit2 ? '' : ' (eip3009_exact only — allowPermit2 is false)') +
      ' — check GET /v1/facilitator/supported.',
  );
}
