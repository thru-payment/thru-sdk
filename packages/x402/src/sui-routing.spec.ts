import { jest } from '@jest/globals';
import { resolveSuiRoute } from './sui-routing.js';
import type { FacilitatorClient } from './client.js';
import type { RouteRequirements, SupportedKinds } from './types.js';

const SUI_USDC = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
const GAS_OWNER = '0xd56e26357f45198233cf5da9f62e31e476ba293b634c58c2bb7add882bbd62b1';

const baseRoute: Omit<RouteRequirements, 'scheme' | 'extra'> = {
  chain: 'sui',
  network: 'testnet',
  asset: SUI_USDC,
  amountAtomic: 1000000n,
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

describe('resolveSuiRoute', () => {
  it('prefers sui_direct when the facilitator advertises it for this asset', async () => {
    const client = makeClient([
      {
        protocol: 'x402',
        scheme: 'sui_direct',
        chain: 'sui',
        network: 'testnet',
        assets: [{ coinType: SUI_USDC, symbol: 'USDC', decimals: 6, maxPaymentAtomic: '100000000' }],
        extra: {},
      },
      {
        protocol: 'x402',
        scheme: 'sui_sponsored',
        chain: 'sui',
        network: 'testnet',
        assets: [{ coinType: SUI_USDC, symbol: 'USDC', decimals: 6, maxPaymentAtomic: '100000000' }],
        extra: { gasOwner: GAS_OWNER },
      },
    ]);

    const route = await resolveSuiRoute(client, baseRoute);
    expect(route.scheme).toBe('sui_direct');
    expect(route.extra).toEqual({});
  });

  it('falls back to sui_sponsored (with the quoted gasOwner) when sui_direct is not advertised', async () => {
    const client = makeClient([
      {
        protocol: 'x402',
        scheme: 'sui_sponsored',
        chain: 'sui',
        network: 'testnet',
        assets: [{ coinType: SUI_USDC, symbol: 'USDC', decimals: 6, maxPaymentAtomic: '100000000' }],
        extra: { gasOwner: GAS_OWNER },
      },
    ]);

    const route = await resolveSuiRoute(client, baseRoute);
    expect(route.scheme).toBe('sui_sponsored');
    expect(route.extra).toEqual({ gasOwner: GAS_OWNER });
  });

  it('rejects the sponsored fallback when allowSponsored is false', async () => {
    const client = makeClient([
      {
        protocol: 'x402',
        scheme: 'sui_sponsored',
        chain: 'sui',
        network: 'testnet',
        assets: [{ coinType: SUI_USDC, symbol: 'USDC', decimals: 6, maxPaymentAtomic: '100000000' }],
        extra: { gasOwner: GAS_OWNER },
      },
    ]);

    await expect(resolveSuiRoute(client, baseRoute, { allowSponsored: false })).rejects.toThrow(
      /No eligible Sui settlement scheme/,
    );
  });

  it('throws when neither scheme is advertised for this asset', async () => {
    const client = makeClient([]);
    await expect(resolveSuiRoute(client, baseRoute)).rejects.toThrow(/No eligible Sui settlement scheme/);
  });

  it('throws when the facilitator advertises sui_sponsored with no gasOwner', async () => {
    const client = makeClient([
      {
        protocol: 'x402',
        scheme: 'sui_sponsored',
        chain: 'sui',
        network: 'testnet',
        assets: [{ coinType: SUI_USDC, symbol: 'USDC', decimals: 6, maxPaymentAtomic: '100000000' }],
        extra: {},
      },
    ]);

    await expect(resolveSuiRoute(client, baseRoute)).rejects.toThrow(/returned no gasOwner/);
  });

  it('ignores kinds for a different asset', async () => {
    const client = makeClient([
      {
        protocol: 'x402',
        scheme: 'sui_direct',
        chain: 'sui',
        network: 'testnet',
        assets: [{ coinType: '0xOTHER::coin::COIN', symbol: 'OTHER', decimals: 6, maxPaymentAtomic: '100000000' }],
        extra: {},
      },
    ]);

    await expect(resolveSuiRoute(client, baseRoute)).rejects.toThrow(/No eligible Sui settlement scheme/);
  });
});
