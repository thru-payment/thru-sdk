import { jest } from '@jest/globals';
import { verifyTypedData, Wallet } from 'ethers';
import { createTestAgent } from './agent-client.js';
import { buildChallengeHeaders } from '../challenge.js';
import type { RouteRequirements } from '../types.js';
import { PERMIT2_DOMAIN_NAME, PERMIT2_ADDRESS, PERMIT_TRANSFER_FROM_TYPES } from './agent-client.js';

// Construction-logic-only tests (plan Task 12 Step 1): no live chain calls. All network/RPC
// interactions the agent client would normally make (allowance checks, one-time approve,
// broadcasting, /supported lookups) are injected via a `deps`-style fetch/provider stub.

const evmRoute: RouteRequirements = {
  scheme: 'permit2_exact',
  chain: 'bnb',
  network: 'testnet',
  asset: '0x337610d27c682e347c9cd60bd4b3b107c9d34ddd',
  amountAtomic: 1_000000000000000000n,
  payTo: '0x222222222222222222222222222222222222222B',
  resource: 'https://api.example.com/report',
  maxTimeoutSeconds: 300,
};

function make402Response(route: RouteRequirements, mppSecret = 'secret'): Response {
  const headers = buildChallengeHeaders(route, { mppSecret });
  return new Response(null, { status: 402, headers });
}

describe('createTestAgent (evm) — permit construction', () => {
  const privateKey = '0x' + '22'.repeat(32);
  const wallet = new Wallet(privateKey);
  const relayerSpender = '0x333333333333333333333333333333333333333C';

  it('signs a PermitTransferFrom whose recovered signer matches the agent wallet address', async () => {
    let capturedPermitSignatureHeader: string | undefined;

    const fetchMock = jest.fn(async (url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (!init || !init.headers || !('PAYMENT-SIGNATURE' in (init.headers as Record<string, string>))) {
        // First call: no payment header yet -> return the 402 challenge.
        return make402Response(evmRoute);
      }
      capturedPermitSignatureHeader = (init.headers as Record<string, string>)['PAYMENT-SIGNATURE'];
      return new Response(JSON.stringify({ ok: true, url: urlStr }), { status: 200 });
    }) as unknown as typeof fetch;

    const agent = createTestAgent({
      kind: 'evm',
      privateKey,
      rpcUrl: 'http://localhost:8545',
    });

    const response = await agent.fetchWithPayment('https://merchant.example.com/report', {
      deps: {
        fetch: fetchMock,
        ensureAllowance: jest.fn(async () => undefined),
        spenderFor: jest.fn(async () => relayerSpender),
      } as unknown as never,
    } as unknown as RequestInit);

    expect(response.status).toBe(200);
    expect(capturedPermitSignatureHeader).toBeTruthy();

    const envelope = JSON.parse(Buffer.from(capturedPermitSignatureHeader!, 'base64').toString('utf8'));
    expect(envelope.scheme).toBe('permit2_exact');
    expect(envelope.payload.payer.toLowerCase()).toBe(wallet.address.toLowerCase());

    const { permit, transferTo, signature } = envelope.payload;
    const domain = { name: PERMIT2_DOMAIN_NAME, chainId: 97, verifyingContract: PERMIT2_ADDRESS };
    const value = {
      permitted: { token: permit.token, amount: BigInt(permit.amount) },
      spender: relayerSpender,
      nonce: BigInt(permit.nonce),
      deadline: BigInt(permit.deadline),
    };
    const recovered = verifyTypedData(domain, PERMIT_TRANSFER_FROM_TYPES, value, signature);
    expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase());
    expect(transferTo.toLowerCase()).toBe(evmRoute.payTo.toLowerCase());
    expect(permit.token.toLowerCase()).toBe(evmRoute.asset.toLowerCase());
    expect(permit.amount).toBe(evmRoute.amountAtomic.toString());
  });

  it('generates a fresh random 256-bit nonce on each call (not deterministic/reused)', async () => {
    const seenNonces: string[] = [];

    async function runOnce(): Promise<void> {
      const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
        if (!init?.headers || !('PAYMENT-SIGNATURE' in (init.headers as Record<string, string>))) {
          return make402Response(evmRoute);
        }
        const header = (init.headers as Record<string, string>)['PAYMENT-SIGNATURE'];
        const envelope = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
        seenNonces.push(envelope.payload.permit.nonce as string);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof fetch;

      const agent = createTestAgent({ kind: 'evm', privateKey, rpcUrl: 'http://localhost:8545' });
      await agent.fetchWithPayment('https://merchant.example.com/report', {
        deps: {
          fetch: fetchMock,
          ensureAllowance: jest.fn(async () => undefined),
          spenderFor: jest.fn(async () => relayerSpender),
        } as unknown as never,
      } as unknown as RequestInit);
    }

    await runOnce();
    await runOnce();

    expect(seenNonces).toHaveLength(2);
    expect(seenNonces[0]).not.toBe(seenNonces[1]);
    // 256-bit nonce: fits within a uint256, and in practice is astronomically unlikely to be small.
    for (const n of seenNonces) {
      expect(BigInt(n) >= 0n).toBe(true);
      expect(BigInt(n) < 2n ** 256n).toBe(true);
    }
  });

  it('sets deadline to now + maxTimeoutSeconds from the requirements', async () => {
    const before = Math.floor(Date.now() / 1000);
    let capturedDeadline = 0n;

    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      if (!init?.headers || !('PAYMENT-SIGNATURE' in (init.headers as Record<string, string>))) {
        return make402Response(evmRoute);
      }
      const header = (init.headers as Record<string, string>)['PAYMENT-SIGNATURE'];
      const envelope = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
      capturedDeadline = BigInt(envelope.payload.permit.deadline);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const agent = createTestAgent({ kind: 'evm', privateKey, rpcUrl: 'http://localhost:8545' });
    await agent.fetchWithPayment('https://merchant.example.com/report', {
      deps: {
        fetch: fetchMock,
        ensureAllowance: jest.fn(async () => undefined),
        spenderFor: jest.fn(async () => relayerSpender),
      } as unknown as never,
    } as unknown as RequestInit);

    const after = Math.floor(Date.now() / 1000);
    expect(capturedDeadline).toBeGreaterThanOrEqual(BigInt(before + evmRoute.maxTimeoutSeconds));
    expect(capturedDeadline).toBeLessThanOrEqual(BigInt(after + evmRoute.maxTimeoutSeconds + 5));
  });

  it('ensures Permit2 allowance is set before signing (one-time approve path)', async () => {
    const ensureAllowance = jest.fn(async () => undefined);
    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      if (!init?.headers || !('PAYMENT-SIGNATURE' in (init.headers as Record<string, string>))) {
        return make402Response(evmRoute);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const agent = createTestAgent({ kind: 'evm', privateKey, rpcUrl: 'http://localhost:8545' });
    await agent.fetchWithPayment('https://merchant.example.com/report', {
      deps: {
        fetch: fetchMock,
        ensureAllowance,
        spenderFor: jest.fn(async () => relayerSpender),
      } as unknown as never,
    } as unknown as RequestInit);

    expect(ensureAllowance).toHaveBeenCalledTimes(1);
    expect(ensureAllowance).toHaveBeenCalledWith(
      expect.objectContaining({ token: evmRoute.asset }),
    );
  });

  it('returns the resource response unmodified once payment succeeds', async () => {
    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      if (!init?.headers || !('PAYMENT-SIGNATURE' in (init.headers as Record<string, string>))) {
        return make402Response(evmRoute);
      }
      return new Response(JSON.stringify({ report: 'contents' }), {
        status: 200,
        headers: { 'PAYMENT-RESPONSE': 'abc' },
      });
    }) as unknown as typeof fetch;

    const agent = createTestAgent({ kind: 'evm', privateKey, rpcUrl: 'http://localhost:8545' });
    const response = await agent.fetchWithPayment('https://merchant.example.com/report', {
      deps: {
        fetch: fetchMock,
        ensureAllowance: jest.fn(async () => undefined),
        spenderFor: jest.fn(async () => relayerSpender),
      } as unknown as never,
    } as unknown as RequestInit);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ report: 'contents' });
    expect(response.headers.get('PAYMENT-RESPONSE')).toBe('abc');
  });
});

describe('createTestAgent (sui) — sponsored tx construction', () => {
  const suiRoute: RouteRequirements = {
    scheme: 'sui_sponsored',
    chain: 'sui',
    network: 'testnet',
    asset: '0x2::sui::SUI',
    amountAtomic: 1_000_000n,
    payTo: '0xMERCHANTSUI0000000000000000000000000000000000000000000000001',
    resource: 'https://api.example.com/report',
    maxTimeoutSeconds: 300,
  };

  const sponsorAddress = '0xSPONSOR000000000000000000000000000000000000000000000000000001';

  function makeSuiBuilder() {
    return {
      // Mocked transaction builder: records the calls the agent client makes.
      calls: { setSender: [] as string[], setGasOwner: [] as string[], splitCoins: [] as unknown[], transferObjects: [] as unknown[] },
    };
  }

  it('builds a transfer tx with setSender(payer) and setGasOwner(sponsor), signs it, and retries with PAYMENT-SIGNATURE', async () => {
    const builderState = makeSuiBuilder();
    let capturedHeader: string | undefined;

    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      if (!init?.headers || !('PAYMENT-SIGNATURE' in (init.headers as Record<string, string>))) {
        return make402Response(suiRoute);
      }
      capturedHeader = (init.headers as Record<string, string>)['PAYMENT-SIGNATURE'];
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const buildSponsoredTx = jest.fn(async (input: {
      sender: string;
      gasOwner: string;
      recipient: string;
      coinType: string;
      amount: bigint;
    }) => {
      builderState.calls.setSender.push(input.sender);
      builderState.calls.setGasOwner.push(input.gasOwner);
      return { txBytesB64: 'dHhieXRlcw==', senderSignatureB64: 'c2lnbmF0dXJl' };
    });

    const agent = createTestAgent({
      kind: 'sui',
      keypairSeed: 'test-seed',
      rpcUrl: 'http://localhost:9000',
      sponsorAddress,
    });

    const response = await agent.fetchWithPayment('https://merchant.example.com/report', {
      deps: { fetch: fetchMock, buildSponsoredTx } as unknown as never,
    } as unknown as RequestInit);

    expect(response.status).toBe(200);
    expect(buildSponsoredTx).toHaveBeenCalledTimes(1);
    const call = buildSponsoredTx.mock.calls[0][0] as {
      sender: string;
      gasOwner: string;
      recipient: string;
      coinType: string;
      amount: bigint;
    };
    expect(call.gasOwner).toBe(sponsorAddress);
    expect(call.recipient).toBe(suiRoute.payTo);
    expect(call.coinType).toBe(suiRoute.asset);
    expect(call.amount).toBe(suiRoute.amountAtomic);

    expect(capturedHeader).toBeTruthy();
    const envelope = JSON.parse(Buffer.from(capturedHeader!, 'base64').toString('utf8'));
    expect(envelope.scheme).toBe('sui_sponsored');
    expect(envelope.payload.txBytesB64).toBe('dHhieXRlcw==');
    expect(envelope.payload.senderSignatureB64).toBe('c2lnbmF0dXJl');
  });

  it('propagates a build failure without retrying the request', async () => {
    const fetchMock = jest.fn(async () => make402Response(suiRoute)) as unknown as typeof fetch;
    const buildSponsoredTx = jest.fn(async () => {
      throw new Error('insufficient sponsor gas');
    });

    const agent = createTestAgent({
      kind: 'sui',
      keypairSeed: 'test-seed',
      rpcUrl: 'http://localhost:9000',
      sponsorAddress,
    });

    await expect(
      agent.fetchWithPayment('https://merchant.example.com/report', {
        deps: { fetch: fetchMock, buildSponsoredTx } as unknown as never,
      } as unknown as RequestInit),
    ).rejects.toThrow('insufficient sponsor gas');

    // Only the initial 402 probe happened — no retry with a broken payload.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a sui_sponsored route when no sponsorAddress was configured, before ever building a tx', async () => {
    const fetchMock = jest.fn(async () => make402Response(suiRoute)) as unknown as typeof fetch;
    const buildSponsoredTx = jest.fn(async () => ({ txBytesB64: 'x', senderSignatureB64: 'y' }));

    // No sponsorAddress passed — sui_sponsored has no fallback for it.
    const agent = createTestAgent({ kind: 'sui', keypairSeed: 'test-seed', rpcUrl: 'http://localhost:9000' });

    await expect(
      agent.fetchWithPayment('https://merchant.example.com/report', {
        deps: { fetch: fetchMock, buildSponsoredTx } as unknown as never,
      } as unknown as RequestInit),
    ).rejects.toThrow(/sponsorAddress/);
    expect(buildSponsoredTx).not.toHaveBeenCalled();
  });
});

describe('createTestAgent (sui) — sui_direct (SIP-58 gasless) construction', () => {
  const gaslessRoute: RouteRequirements = {
    scheme: 'sui_direct',
    chain: 'sui',
    network: 'testnet',
    asset: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
    amountAtomic: 1_000_000n,
    payTo: '0xMERCHANTSUI0000000000000000000000000000000000000000000000001',
    resource: 'https://api.example.com/report',
    maxTimeoutSeconds: 300,
  };

  it('builds a gasless tx with no sponsor involved, signs it, and retries with scheme=sui_direct', async () => {
    let capturedHeader: string | undefined;

    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      if (!init?.headers || !('PAYMENT-SIGNATURE' in (init.headers as Record<string, string>))) {
        return make402Response(gaslessRoute);
      }
      capturedHeader = (init.headers as Record<string, string>)['PAYMENT-SIGNATURE'];
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const buildGaslessTx = jest.fn(async (input: {
      sender: string;
      recipient: string;
      coinType: string;
      amount: bigint;
    }) => ({ txBytesB64: 'Z2FzbGVzcw==', senderSignatureB64: 'c2lnbmF0dXJl' }));
    const buildSponsoredTx = jest.fn();

    // No sponsorAddress — sui_direct doesn't need one.
    const agent = createTestAgent({ kind: 'sui', keypairSeed: 'test-seed', rpcUrl: 'http://localhost:9000' });

    const response = await agent.fetchWithPayment('https://merchant.example.com/report', {
      deps: { fetch: fetchMock, buildGaslessTx, buildSponsoredTx } as unknown as never,
    } as unknown as RequestInit);

    expect(response.status).toBe(200);
    expect(buildSponsoredTx).not.toHaveBeenCalled();
    expect(buildGaslessTx).toHaveBeenCalledTimes(1);
    const call = buildGaslessTx.mock.calls[0][0] as {
      sender: string;
      recipient: string;
      coinType: string;
      amount: bigint;
    };
    expect(call.recipient).toBe(gaslessRoute.payTo);
    expect(call.coinType).toBe(gaslessRoute.asset);
    expect(call.amount).toBe(gaslessRoute.amountAtomic);
    expect(call).not.toHaveProperty('gasOwner');

    expect(capturedHeader).toBeTruthy();
    const envelope = JSON.parse(Buffer.from(capturedHeader!, 'base64').toString('utf8'));
    expect(envelope.scheme).toBe('sui_direct');
    expect(envelope.payload.txBytesB64).toBe('Z2FzbGVzcw==');
    expect(envelope.payload.senderSignatureB64).toBe('c2lnbmF0dXJl');
  });

  it('propagates a gasless-build failure without retrying the request', async () => {
    const fetchMock = jest.fn(async () => make402Response(gaslessRoute)) as unknown as typeof fetch;
    const buildGaslessTx = jest.fn(async () => {
      throw new Error('insufficient address balance');
    });

    const agent = createTestAgent({ kind: 'sui', keypairSeed: 'test-seed', rpcUrl: 'http://localhost:9000' });

    await expect(
      agent.fetchWithPayment('https://merchant.example.com/report', {
        deps: { fetch: fetchMock, buildGaslessTx } as unknown as never,
      } as unknown as RequestInit),
    ).rejects.toThrow('insufficient address balance');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('createTestAgent — no-402 passthrough', () => {
  it('returns the response as-is when the resource is not actually payment-gated', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({ free: true }), { status: 200 })) as unknown as typeof fetch;

    const agent = createTestAgent({
      kind: 'evm',
      privateKey: '0x' + '33'.repeat(32),
      rpcUrl: 'http://localhost:8545',
    });

    const response = await agent.fetchWithPayment('https://merchant.example.com/free', {
      deps: { fetch: fetchMock } as unknown as never,
    } as unknown as RequestInit);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
