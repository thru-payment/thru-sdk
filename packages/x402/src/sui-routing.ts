// Sui scheme auto-selection (spec §8 follow-up): a merchant pricing a Sui route in
// `RouteRequirements` currently has to know, per asset, whether `sui_direct` (gasless,
// SIP-58 `redeem_funds`/`send_funds`, no sponsor) or `sui_sponsored` (the sponsor co-signs and
// pays gas) applies — that's facilitator-internal plumbing (`SIP58_GASLESS_COIN_TYPES`), not
// something a merchant should have to track or keep in sync as the eligible-asset list grows.
//
// `resolveSuiRoute` asks the facilitator's own `GET /v1/facilitator/supported` — the single
// source of truth for what's actually settleable right now — and fills in `scheme` (preferring
// the gasless path whenever it's advertised) and `extra` (the sponsor's `gasOwner`, when needed)
// for you. Cache the result per (network, asset) if calling this on a hot path; it's meant to run
// once at startup, same as the existing "call supported() at boot to fail fast" guidance.

import type { FacilitatorClient } from './client.js';
import type { RouteRequirements, Scheme, SupportedAssetSui, SupportedKind } from './types.js';

export interface ResolveSuiRouteOptions {
  /** Set false to require the gasless path and reject ineligible assets instead of silently
   * falling back to a sponsor-paid settlement. Default true. */
  allowSponsored?: boolean;
}

function isSuiAsset(a: SupportedAssetSui | { address: string }): a is SupportedAssetSui {
  return 'coinType' in a;
}

function findKind(kinds: SupportedKind[], scheme: Scheme, network: string, asset: string): SupportedKind | undefined {
  return kinds.find(
    (k) =>
      k.protocol === 'x402' &&
      k.scheme === scheme &&
      k.chain === 'sui' &&
      k.network === network &&
      k.assets.some((a) => isSuiAsset(a) && a.coinType === asset),
  );
}

/**
 * Resolve a Sui `RouteRequirements` without pinning `scheme`/`extra` by hand. Prefers
 * `sui_direct` (no gas sponsor) whenever the facilitator advertises it for this
 * `(network, asset)`; falls back to `sui_sponsored` (using the facilitator's own quoted
 * `gasOwner`) otherwise, unless `allowSponsored: false`.
 *
 * Throws if the facilitator advertises neither scheme for this asset — that's a real
 * configuration problem (unknown/unsupported asset, or the facilitator is dormant) and should
 * fail loudly at startup rather than produce a route that will 402 forever.
 */
export async function resolveSuiRoute(
  client: FacilitatorClient,
  route: Omit<RouteRequirements, 'scheme' | 'extra'> & { extra?: Record<string, unknown> },
  opts?: ResolveSuiRouteOptions,
): Promise<RouteRequirements> {
  const { kinds } = await client.supported();
  const allowSponsored = opts?.allowSponsored ?? true;

  const direct = findKind(kinds, 'sui_direct', route.network, route.asset);
  if (direct) {
    return { ...route, scheme: 'sui_direct', extra: { ...route.extra } };
  }

  if (allowSponsored) {
    const sponsored = findKind(kinds, 'sui_sponsored', route.network, route.asset);
    if (sponsored) {
      if (!sponsored.extra.gasOwner) {
        throw new Error(
          `Facilitator advertises sui_sponsored for ${route.asset} on ${route.network} but returned no gasOwner`,
        );
      }
      return {
        ...route,
        scheme: 'sui_sponsored',
        extra: { ...route.extra, gasOwner: sponsored.extra.gasOwner },
      };
    }
  }

  throw new Error(
    `No eligible Sui settlement scheme for asset ${route.asset} on ${route.network}` +
      (allowSponsored ? '' : ' (sui_direct only — allowSponsored is false)') +
      ' — check GET /v1/facilitator/supported.',
  );
}
