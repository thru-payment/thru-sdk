import { jest } from '@jest/globals';
import { resolveEvmRoute } from './evm-routing.js';
import type { FacilitatorClient } from './client.js';
import type { RouteRequirements, SupportedKinds } from './types.js';

const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const DOMAIN = { name: 'Global Dollar', version: '1' };

const baseRoute: Omit<RouteRequirements, 'scheme' | 'extra'> = {
  chain: 'robinhood',
  network: 'mainnet',
  asset: USDG,
  amountAtomic: 5000000n,
  payTo: '0xMERCHANT',
  resource: 'https://api.example.com/report',
  maxTimeoutSeconds: 300,
};

function makeClient(kinds: SupportedKinds['kinds']): FacilitatorClient {
  return {
    verify: jest.fn(),
    settle: jest.fn(),
    supported: jest.fn(async (): Promise<SupportedKinds> => ({ kinds })),
  } as unknown as FacilitatorClient;
}

describe('resolveEvmRoute', () => {
  it('prefers eip3009_exact when the facilitator advertises it for this asset', async () => {
    const client = makeClient([
      {
        protocol: 'x402',
        scheme: 'eip3009_exact',
        chain: 'robinhood',
        network: 'mainnet',
        assets: [{ address: USDG, symbol: 'USDG', decimals: 6, maxPaymentAtomic: '100000000', eip3009: DOMAIN }],
        extra: {},
      },
      {
        protocol: 'x402',
        scheme: 'permit2_exact',
        chain: 'robinhood',
        network: 'mainnet',
        assets: [{ address: USDG, symbol: 'USDG', decimals: 6, maxPaymentAtomic: '100000000' }],
        extra: { spender: '0xRELAYER' },
      },
    ]);

    const route = await resolveEvmRoute(client, baseRoute);
    expect(route.scheme).toBe('eip3009_exact');
    expect(route.extra).toEqual({});
  });

  it('falls back to permit2_exact when eip3009_exact is not advertised', async () => {
    const client = makeClient([
      {
        protocol: 'x402',
        scheme: 'permit2_exact',
        chain: 'robinhood',
        network: 'mainnet',
        assets: [{ address: USDG, symbol: 'USDG', decimals: 6, maxPaymentAtomic: '100000000' }],
        extra: { spender: '0xRELAYER' },
      },
    ]);

    const route = await resolveEvmRoute(client, baseRoute);
    expect(route.scheme).toBe('permit2_exact');
  });

  it('rejects the permit2 fallback when allowPermit2 is false', async () => {
    const client = makeClient([
      {
        protocol: 'x402',
        scheme: 'permit2_exact',
        chain: 'robinhood',
        network: 'mainnet',
        assets: [{ address: USDG, symbol: 'USDG', decimals: 6, maxPaymentAtomic: '100000000' }],
        extra: { spender: '0xRELAYER' },
      },
    ]);

    await expect(resolveEvmRoute(client, baseRoute, { allowPermit2: false })).rejects.toThrow(
      /No eligible EVM settlement scheme/,
    );
  });

  it('throws when neither scheme is advertised for this asset', async () => {
    const client = makeClient([]);
    await expect(resolveEvmRoute(client, baseRoute)).rejects.toThrow(/No eligible EVM settlement scheme/);
  });

  it('matches EVM addresses case-insensitively', async () => {
    const client = makeClient([
      {
        protocol: 'x402',
        scheme: 'eip3009_exact',
        chain: 'robinhood',
        network: 'mainnet',
        assets: [{ address: USDG.toUpperCase(), symbol: 'USDG', decimals: 6, maxPaymentAtomic: '100000000', eip3009: DOMAIN }],
        extra: {},
      },
    ]);

    const route = await resolveEvmRoute(client, baseRoute);
    expect(route.scheme).toBe('eip3009_exact');
  });

  it('ignores kinds for a different chain', async () => {
    const client = makeClient([
      {
        protocol: 'x402',
        scheme: 'eip3009_exact',
        chain: 'bnb',
        network: 'mainnet',
        assets: [{ address: USDG, symbol: 'USDG', decimals: 6, maxPaymentAtomic: '100000000', eip3009: DOMAIN }],
        extra: {},
      },
    ]);

    await expect(resolveEvmRoute(client, baseRoute)).rejects.toThrow(/No eligible EVM settlement scheme/);
  });
});
