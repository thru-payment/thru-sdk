// `findSupportedKind` is the one lookup shared by `resolveEvmRoute` and `resolveSuiRoute`. It
// replaced two near-identical `findKind` copies whose only real difference was how they compared
// an asset identifier — EVM addresses case-insensitively, Sui coin types exactly. Both rules now
// live in one predicate, so both are pinned here.

import { findSupportedKind } from './supported-kinds.js';
import type { SupportedKind } from './types.js';

const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const SUI_USDC = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';

const evmKind: SupportedKind = {
  protocol: 'x402',
  scheme: 'eip3009_exact',
  chain: 'robinhood',
  network: 'mainnet',
  assets: [{ address: USDG, symbol: 'USDG', decimals: 6, maxPaymentAtomic: '100000000' }],
  extra: {},
};

const suiKind: SupportedKind = {
  protocol: 'x402',
  scheme: 'sui_direct',
  chain: 'sui',
  network: 'testnet',
  assets: [{ coinType: SUI_USDC, symbol: 'USDC', decimals: 6, maxPaymentAtomic: '100000000' }],
  extra: {},
};

const evmQuery = { scheme: 'eip3009_exact', chain: 'robinhood', network: 'mainnet', asset: USDG } as const;
const suiQuery = { scheme: 'sui_direct', chain: 'sui', network: 'testnet', asset: SUI_USDC } as const;

describe('findSupportedKind', () => {
  it('matches an exact EVM query', () => {
    expect(findSupportedKind([evmKind], evmQuery)).toBe(evmKind);
  });

  it('matches an exact Sui query', () => {
    expect(findSupportedKind([suiKind], suiQuery)).toBe(suiKind);
  });

  it('compares EVM addresses case-insensitively', () => {
    // The same contract is written checksummed in one config and lowercased in another.
    expect(findSupportedKind([evmKind], { ...evmQuery, asset: USDG.toLowerCase() })).toBe(evmKind);
    expect(findSupportedKind([evmKind], { ...evmQuery, asset: USDG.toUpperCase() })).toBe(evmKind);
  });

  it('compares Sui coin types EXACTLY — the module/struct segments are case-sensitive', () => {
    // `::usdc::USDC` and `::USDC::USDC` are different Move types. Lowercasing here would resolve a
    // route against a type the payer cannot actually spend.
    expect(findSupportedKind([suiKind], { ...suiQuery, asset: SUI_USDC.toLowerCase() })).toBeUndefined();
    expect(findSupportedKind([suiKind], { ...suiQuery, asset: SUI_USDC.toUpperCase() })).toBeUndefined();
  });

  it('does not match an EVM-shaped asset entry against a Sui coin type, or vice versa', () => {
    expect(findSupportedKind([evmKind], { ...evmQuery, asset: SUI_USDC })).toBeUndefined();
    expect(findSupportedKind([suiKind], { ...suiQuery, asset: USDG })).toBeUndefined();
  });

  it('ignores kinds that differ in scheme, chain, or network', () => {
    expect(findSupportedKind([evmKind], { ...evmQuery, scheme: 'permit2_exact' })).toBeUndefined();
    expect(findSupportedKind([evmKind], { ...evmQuery, chain: 'bnb' })).toBeUndefined();
    expect(findSupportedKind([evmKind], { ...evmQuery, network: 'testnet' })).toBeUndefined();
  });

  it('ignores the mpp kinds — the route resolvers only build x402 challenges', () => {
    const mppKind: SupportedKind = { ...evmKind, protocol: 'mpp' };
    expect(findSupportedKind([mppKind], evmQuery)).toBeUndefined();
    // ...but still finds the x402 kind sitting alongside it.
    expect(findSupportedKind([mppKind, evmKind], evmQuery)).toBe(evmKind);
  });

  it('returns undefined for an empty kinds list', () => {
    expect(findSupportedKind([], evmQuery)).toBeUndefined();
  });
});
