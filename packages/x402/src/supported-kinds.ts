// Lookup helper over `GET /v1/facilitator/supported`, shared by `evm-routing.ts` and
// `sui-routing.ts`.
//
// INTERNAL: not re-exported from `index.ts` or any `exports` subpath. `resolveEvmRoute` /
// `resolveSuiRoute` are the public surface; this is the predicate both of them used to carry their
// own near-identical copy of.
//
// Zero dependencies — this sits under the merchant-side route resolvers, which must stay loadable
// without `ethers` / `@mysten/sui`.

import type { Chain, Scheme, SupportedAssetBnb, SupportedAssetSui, SupportedKind } from './types.js';

/**
 * Does a `/supported` asset entry name `wanted`?
 *
 * EVM entries are keyed by a hex contract `address`, compared case-INSENSITIVELY: the same token
 * shows up EIP-55-checksummed in some configs and all-lowercase in others, and both mean the same
 * contract. Sui entries are keyed by a `coinType` (`0x…::usdc::USDC`), compared EXACTLY: the
 * module and struct segments of a Sui type are case-sensitive identifiers, so lowercasing them
 * would match types that are genuinely different.
 *
 * Those two rules are what the previous per-file copies each implemented; keeping both here is
 * what lets one function serve both resolvers.
 */
function assetMatches(asset: SupportedAssetBnb | SupportedAssetSui, wanted: string): boolean {
  if ('address' in asset) {
    return asset.address.toLowerCase() === wanted.toLowerCase();
  }
  return asset.coinType === wanted;
}

export interface SupportedKindQuery {
  scheme: Scheme;
  chain: Chain;
  network: string;
  asset: string;
}

/**
 * Find the `x402` kind the facilitator advertises for exactly this (scheme, chain, network, asset),
 * or `undefined`. `protocol === 'x402'` is required because the MPP kinds describe the same
 * settlement paths under a different credential format — matching one of those would report a
 * route as resolvable over a protocol the merchant-side resolvers don't build challenges for.
 */
export function findSupportedKind(
  kinds: SupportedKind[],
  query: SupportedKindQuery,
): SupportedKind | undefined {
  return kinds.find(
    (k) =>
      k.protocol === 'x402' &&
      k.scheme === query.scheme &&
      k.chain === query.chain &&
      k.network === query.network &&
      k.assets.some((a) => assetMatches(a, query.asset)),
  );
}
