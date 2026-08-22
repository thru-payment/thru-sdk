// Minimal paying agent client — **internal E2E test harness only, not a supported product
// surface** (spec §8, plan Task 12). Given a priced resource that returns a 402 per
// `buildChallengeHeaders`, constructs the appropriate on-chain payment authorization (Permit2
// signature on BNB, sponsored transaction on Sui) and retries the request with the x402
// `PAYMENT-SIGNATURE` header.
//
// `ethers` and `@mysten/sui` are optional peer deps of this package (see package.json) — they are
// only ever imported/used here, inside `testing/`, never from the middleware/client/challenge
// modules that ship to merchants.

import { randomBytes } from 'node:crypto';
import { decodeRequirementsFromHeader } from '../challenge.js';
import type { RouteRequirements } from '../types.js';

/** EIP-712 domain name for Permit2 — matches `apps/api/.../evm-permit2.scheme.ts#permit2Domain`. */
export const PERMIT2_DOMAIN_NAME = 'Permit2';

/** Canonical Permit2 address — identical on every EVM chain (spec §9 / Global Constraints). */
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

/** EIP-712 types for the `PermitTransferFrom` struct — mirrors the API-side scheme exactly. */
export const PERMIT_TRANSFER_FROM_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  PermitTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

/** EIP-712 types for `TransferWithAuthorization` — canonical EIP-3009 shape, mirrors the API-side
 * scheme exactly (apps/api/.../eip3009-exact.scheme.ts#TRANSFER_WITH_AUTHORIZATION_TYPES). */
export const TRANSFER_WITH_AUTHORIZATION_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

const CHAIN_ID_BY_CHAIN_NETWORK: Record<'bnb' | 'robinhood', Record<'mainnet' | 'testnet', number>> = {
  bnb: { mainnet: 56, testnet: 97 },
  robinhood: { mainnet: 4663, testnet: 46630 },
};

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
];

export type EvmAgentOptions = {
  kind: 'evm';
  privateKey: string;
  rpcUrl: string;
  /** Defaults to 'bnb' — set 'robinhood' when paying a Robinhood Chain route. */
  chain?: 'bnb' | 'robinhood';
};
export type SuiAgentOptions = {
  kind: 'sui';
  keypairSeed: string;
  rpcUrl: string;
  /** Only needed for the `sui_sponsored` scheme. `sui_direct` (SIP-58 gasless) needs no sponsor —
   * the payer pays $0 gas directly from their own address balance. */
  sponsorAddress?: string;
};

export interface TestAgent {
  fetchWithPayment(url: string, init?: RequestInit): Promise<Response>;
}

/** Injectable EVM dependencies — real ethers calls by default, stubbed in unit tests. */
export interface EvmAgentDeps {
  fetch: typeof fetch;
  /** Ensure the payer has approved Permit2 for at least `amount` of `token` (one-time approve).
   * Only ever called for `permit2_exact` — `eip3009_exact` needs no allowance at all. */
  ensureAllowance(input: { token: string; owner: string; amount: bigint }): Promise<void>;
  /** Resolve the Permit2 `spender` address (Thru's relayer) for the target resource server. */
  spenderFor(url: string, requirements: RouteRequirements): Promise<string>;
  /** Resolve the token's own EIP-712 domain identity for an `eip3009_exact` route — an operator-
   * confirmed value the facilitator quotes back via `/v1/facilitator/supported`, never guessed
   * client-side (see registry/facilitator-token.registry.ts#Eip3009Domain). */
  eip3009DomainFor(url: string, requirements: RouteRequirements): Promise<{ name: string; version: string }>;
}

/** Injectable Sui dependencies — real `@mysten/sui` calls by default, stubbed in unit tests. */
export interface SuiAgentDeps {
  fetch: typeof fetch;
  buildSponsoredTx(input: {
    sender: string;
    gasOwner: string;
    recipient: string;
    coinType: string;
    amount: bigint;
  }): Promise<{ txBytesB64: string; senderSignatureB64: string }>;
  /** `sui_direct` (SIP-58 gasless): builds and signs a $0-gas `balance::send_funds` transaction —
   * no sponsor, no co-signature. Only ever called for SIP-58-eligible coin types; the merchant's
   * route configuration (and `/v1/facilitator/supported`) is what decides whether `sui_direct` is
   * even offered for a given asset. */
  buildGaslessTx(input: {
    sender: string;
    recipient: string;
    coinType: string;
    amount: bigint;
  }): Promise<{ txBytesB64: string; senderSignatureB64: string }>;
}

interface EvmFetchInit extends RequestInit {
  deps?: EvmAgentDeps;
}

interface SuiFetchInit extends RequestInit {
  deps?: SuiAgentDeps;
}

/**
 * Create a minimal paying agent client for E2E testing (spec §8): given `opts` identifying an EVM
 * private key or a Sui keypair seed + sponsor address, `fetchWithPayment` transparently handles a
 * 402 response by constructing and signing the appropriate payment authorization, then retrying.
 */
export function createTestAgent(opts: EvmAgentOptions | SuiAgentOptions): TestAgent {
  if (opts.kind === 'evm') {
    return createEvmAgent(opts);
  }
  return createSuiAgent(opts);
}

// ---------------------------------------------------------------------------------------------
// EVM (Permit2)
// ---------------------------------------------------------------------------------------------

function createEvmAgent(opts: EvmAgentOptions): TestAgent {
  const chain = opts.chain ?? 'bnb';

  return {
    async fetchWithPayment(url: string, init?: RequestInit): Promise<Response> {
      const { deps: injectedDeps, ...restInit } = (init ?? {}) as EvmFetchInit;
      const doFetch = injectedDeps?.fetch ?? fetch;

      const first = await doFetch(url, restInit as RequestInit);
      if (first.status !== 402) {
        return first;
      }

      const challenge = first.headers.get('PAYMENT-REQUIRED');
      if (!challenge) {
        return first;
      }
      const requirements = decodeRequirementsFromHeader(challenge);

      const deps = injectedDeps ?? (await defaultEvmDeps(opts, chain));
      const payer = await evmAddress(opts.privateKey);
      const chainId = CHAIN_ID_BY_CHAIN_NETWORK[chain][requirements.network];
      const caip2 = `eip155:${chainId}`;

      // The merchant's route configuration decides the scheme (it's encoded in the challenge, not
      // negotiated by the payer) — this just follows whichever one was asked for. Use
      // `resolveEvmRoute` on the merchant side to avoid hand-picking this in the first place.
      let payload: Record<string, unknown>;
      let scheme: 'eip3009_exact' | 'permit2_exact';

      if (requirements.scheme === 'eip3009_exact') {
        scheme = 'eip3009_exact';
        const domain = await deps.eip3009DomainFor(url, requirements);
        const nonce = '0x' + randomBytes(32).toString('hex');
        const validAfter = 0n;
        const validBefore = BigInt(Math.floor(Date.now() / 1000) + requirements.maxTimeoutSeconds);

        const signature = await signTransferAuthorization(opts.privateKey, {
          token: requirements.asset,
          from: payer,
          to: requirements.payTo,
          value: requirements.amountAtomic,
          validAfter,
          validBefore,
          nonce,
          chainId,
          domainName: domain.name,
          domainVersion: domain.version,
        });

        payload = {
          auth: {
            token: requirements.asset,
            from: payer,
            to: requirements.payTo,
            value: requirements.amountAtomic.toString(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce,
          },
          signature,
          payer,
        };
      } else if (requirements.scheme === 'permit2_exact') {
        scheme = 'permit2_exact';
        const spender = await deps.spenderFor(url, requirements);

        await deps.ensureAllowance({ token: requirements.asset, owner: payer, amount: requirements.amountAtomic });

        const nonce = randomUint256();
        const deadline = BigInt(Math.floor(Date.now() / 1000) + requirements.maxTimeoutSeconds);

        const signature = await signPermit(opts.privateKey, {
          token: requirements.asset,
          amount: requirements.amountAtomic,
          spender,
          nonce,
          deadline,
          chainId,
        });

        payload = {
          permit: {
            token: requirements.asset,
            amount: requirements.amountAtomic.toString(),
            nonce: nonce.toString(),
            deadline: deadline.toString(),
          },
          transferTo: requirements.payTo,
          signature,
          payer,
        };
      } else {
        throw new Error(`createEvmAgent can't pay an EVM route with scheme "${requirements.scheme}"`);
      }

      const envelope = { x402Version: 2, scheme, network: caip2, payload };
      const paymentSignature = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');

      return doFetch(url, {
        ...restInit,
        headers: {
          ...(restInit.headers as Record<string, string> | undefined),
          'PAYMENT-SIGNATURE': paymentSignature,
        },
      } as RequestInit);
    },
  };
}

function randomUint256(): bigint {
  const bytes = randomBytes(32);
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

async function evmAddress(privateKey: string): Promise<string> {
  const { Wallet } = await import('ethers');
  return new Wallet(privateKey).address;
}

async function signPermit(
  privateKey: string,
  fields: { token: string; amount: bigint; spender: string; nonce: bigint; deadline: bigint; chainId: number },
): Promise<string> {
  const { Wallet } = await import('ethers');
  const wallet = new Wallet(privateKey);
  const domain = { name: PERMIT2_DOMAIN_NAME, chainId: fields.chainId, verifyingContract: PERMIT2_ADDRESS };
  const value = {
    permitted: { token: fields.token, amount: fields.amount },
    spender: fields.spender,
    nonce: fields.nonce,
    deadline: fields.deadline,
  };
  return wallet.signTypedData(domain, PERMIT_TRANSFER_FROM_TYPES, value);
}

async function signTransferAuthorization(
  privateKey: string,
  fields: {
    token: string;
    from: string;
    to: string;
    value: bigint;
    validAfter: bigint;
    validBefore: bigint;
    nonce: string;
    chainId: number;
    domainName: string;
    domainVersion: string;
  },
): Promise<string> {
  const { Wallet } = await import('ethers');
  const wallet = new Wallet(privateKey);
  // Domain is the TOKEN's own — contrast signPermit's fixed Permit2 domain above.
  const domain = {
    name: fields.domainName,
    version: fields.domainVersion,
    chainId: fields.chainId,
    verifyingContract: fields.token,
  };
  const value = {
    from: fields.from,
    to: fields.to,
    value: fields.value,
    validAfter: fields.validAfter,
    validBefore: fields.validBefore,
    nonce: fields.nonce,
  };
  return wallet.signTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, value);
}

async function defaultEvmDeps(opts: EvmAgentOptions, chain: 'bnb' | 'robinhood'): Promise<EvmAgentDeps> {
  const { Contract, JsonRpcProvider, Wallet } = await import('ethers');
  const provider = new JsonRpcProvider(opts.rpcUrl);
  const wallet = new Wallet(opts.privateKey, provider);

  async function supportedKinds(url: string): Promise<
    Array<{
      chain: string;
      scheme: string;
      extra?: { spender?: string | null };
      assets: Array<{ address?: string; eip3009?: { name: string; version: string } }>;
    }>
  > {
    const origin = new URL(url).origin;
    const response = await fetch(`${origin}/v1/facilitator/supported`);
    if (!response.ok) {
      throw new Error(`Failed to look up facilitator capabilities: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { kinds: Awaited<ReturnType<typeof supportedKinds>> };
    return body.kinds;
  }

  return {
    fetch,
    async spenderFor(url: string): Promise<string> {
      // Ask the resource server's Thru facilitator for the current relayer address via
      // `/v1/facilitator/supported` on the same origin as the resource, per spec §7's
      // `extra.spender`. E2E callers typically inject a deps override that already knows the
      // relayer address instead of relying on this default.
      const kinds = await supportedKinds(url);
      const kind = kinds.find((k) => k.chain === chain && k.scheme === 'permit2_exact' && k.extra?.spender);
      if (!kind?.extra?.spender) {
        throw new Error(`No ${chain} permit2 spender advertised by /v1/facilitator/supported`);
      }
      return kind.extra.spender;
    },
    async eip3009DomainFor(url: string, requirements: RouteRequirements): Promise<{ name: string; version: string }> {
      const kinds = await supportedKinds(url);
      const kind = kinds.find((k) => k.chain === chain && k.scheme === 'eip3009_exact');
      const asset = kind?.assets.find((a) => a.address?.toLowerCase() === requirements.asset.toLowerCase());
      if (!asset?.eip3009) {
        throw new Error(`No eip3009 domain for ${requirements.asset} advertised by /v1/facilitator/supported`);
      }
      return asset.eip3009;
    },
    async ensureAllowance({ token, amount }): Promise<void> {
      const erc20 = new Contract(token, ERC20_ABI, wallet) as unknown as {
        allowance(owner: string, spender: string): Promise<bigint>;
        approve(spender: string, amount: bigint): Promise<{ wait(): Promise<unknown> }>;
      };
      const current = await erc20.allowance(wallet.address, PERMIT2_ADDRESS);
      if (current >= amount) {
        return;
      }
      const tx = await erc20.approve(PERMIT2_ADDRESS, 2n ** 256n - 1n);
      await tx.wait();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Sui (sponsored transaction, or SIP-58 gasless direct)
// ---------------------------------------------------------------------------------------------

function createSuiAgent(opts: SuiAgentOptions): TestAgent {
  return {
    async fetchWithPayment(url: string, init?: RequestInit): Promise<Response> {
      const { deps: injectedDeps, ...restInit } = (init ?? {}) as SuiFetchInit;
      const doFetch = injectedDeps?.fetch ?? fetch;

      const first = await doFetch(url, restInit as RequestInit);
      if (first.status !== 402) {
        return first;
      }

      const challenge = first.headers.get('PAYMENT-REQUIRED');
      if (!challenge) {
        return first;
      }
      const requirements = decodeRequirementsFromHeader(challenge);

      const deps = injectedDeps ?? (await defaultSuiDeps(opts));
      const sender = await suiAddress(opts.keypairSeed);

      // The merchant's route configuration decides the scheme (it's encoded in the challenge,
      // not negotiated by the payer) — this just follows whichever one was asked for.
      let txBytesB64: string;
      let senderSignatureB64: string;
      let scheme: 'sui_sponsored' | 'sui_direct';

      if (requirements.scheme === 'sui_direct') {
        scheme = 'sui_direct';
        ({ txBytesB64, senderSignatureB64 } = await deps.buildGaslessTx({
          sender,
          recipient: requirements.payTo,
          coinType: requirements.asset,
          amount: requirements.amountAtomic,
        }));
      } else {
        if (!opts.sponsorAddress) {
          throw new Error(
            'sui_sponsored requires sponsorAddress — pass it in createTestAgent({kind:"sui", ...}), ' +
              'or configure the route for sui_direct if the asset is SIP-58-gasless-eligible.',
          );
        }
        scheme = 'sui_sponsored';
        ({ txBytesB64, senderSignatureB64 } = await deps.buildSponsoredTx({
          sender,
          gasOwner: opts.sponsorAddress,
          recipient: requirements.payTo,
          coinType: requirements.asset,
          amount: requirements.amountAtomic,
        }));
      }

      const envelope = {
        x402Version: 2,
        scheme,
        network: requirements.network === 'mainnet' ? 'sui:mainnet' : 'sui:testnet',
        payload: { txBytesB64, senderSignatureB64, payer: sender },
      };
      const paymentSignature = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');

      return doFetch(url, {
        ...restInit,
        headers: {
          ...(restInit.headers as Record<string, string> | undefined),
          'PAYMENT-SIGNATURE': paymentSignature,
        },
      } as RequestInit);
    },
  };
}

async function suiKeypair(seed: string) {
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
  const { createHmac } = await import('node:crypto');
  const secretKey = createHmac('sha256', seed).update('facilitator-e2e-agent-v1').digest();
  return Ed25519Keypair.fromSecretKey(new Uint8Array(secretKey), { skipValidation: true });
}

async function suiAddress(seed: string): Promise<string> {
  const keypair = await suiKeypair(seed);
  return keypair.toSuiAddress();
}

async function defaultSuiDeps(opts: SuiAgentOptions): Promise<SuiAgentDeps> {
  // gRPC, not the legacy JSON-RPC client: Mysten deprecated legacy JSON-RPC methods
  // (suix_getBalance, sui_dryRunTransactionBlock, ...) on public fullnodes in favor of
  // gRPC/GraphQL. `coinWithBalance`/`tx.balance()` need `client.core.getBalance`/`listCoins` to
  // resolve address-balance sourcing, which throws "Method not found" against a public fullnode
  // over JSON-RPC — this bit both the existing sui_sponsored path and the new sui_direct one, so
  // fixed for both. Same host works fine over gRPC (only the JSON-RPC surface was deprecated) —
  // verified 2026-08-20, see thru-infra's apps/api/src/wallets/sui-wallet.service.ts.
  const { SuiGrpcClient } = await import('@mysten/sui/grpc');
  const { Transaction, coinWithBalance } = await import('@mysten/sui/transactions');
  const network = opts.rpcUrl.includes('mainnet') ? 'mainnet' : 'testnet';
  const client = new SuiGrpcClient({ network, baseUrl: opts.rpcUrl });
  const keypair = await suiKeypair(opts.keypairSeed);

  return {
    fetch,
    async buildSponsoredTx({ sender, gasOwner, recipient, coinType, amount }) {
      const tx = new Transaction();
      tx.setSender(sender);
      tx.setGasOwner(gasOwner);
      // SIP-58 address-balance gas: pay gas from the sponsor's address balance instead of pinning a
      // specific gas coin object. An empty gas payment means no owned gas coin is locked, so the
      // sponsor can co-sign unlimited concurrent sponsored payments without maintaining a gas-coin
      // pool or risking equivocation/epoch-lock (a coin locked until end-of-epoch). Requires the
      // network at protocol >= v125 (mainnet since 2026-05-20; testnet earlier).
      //
      // No manual ValidDuring expiration is needed here: the payment leg below transfers an owned
      // Coin<T> (coinWithBalance), and the protocol's anti-equivocation rule is satisfied by EITHER
      // an owned input OR a ValidDuring expiration — the owned coin anchors this tx. `build()` fills
      // a ValidDuring itself for the fully object-less case (e.g. a payer withdrawing from their own
      // address balance), which this test agent does not exercise.
      tx.setGasPayment([]);
      const coin = coinWithBalance({ balance: amount, type: coinType })(tx);
      tx.transferObjects([coin], recipient);

      const built = await tx.build({ client: client as unknown as never });
      const { bytes, signature } = await keypair.signTransaction(built);
      return { txBytesB64: bytes, senderSignatureB64: signature };
    },
    // sui_direct (SIP-58 gasless): a $0-gas balance::send_funds sourced purely from the payer's
    // own address balance. No sponsor, no gasOwner, no co-signature — the payer's own signature is
    // the only one this transaction ever needs.
    //
    // Two things the Sui network requires that a normal (gas-paying) transaction doesn't:
    //  1. A ValidDuring expiration bounded to `currentEpoch .. currentEpoch + 1` — a transaction
    //     with no owned-object input has no version to pin replay protection against, so the
    //     network rejects anything wider (a `+2` span, despite the error message saying "at most
    //     two epochs", is REJECTED — this matches the SDK's own internal reference for
    //     addressBalance gas mode, transactions/executor/serial.mjs #getValidDuringExpiration).
    //  2. The tx must be built ONCE and those exact bytes signed/executed — handing the
    //     `Transaction` object itself (unbuilt) to something that calls `.build()` again re-runs
    //     the resolver plugins and silently resets the zeroed gas fields and the expiration you
    //     just set. `tx.build({client})` here, then `keypair.signTransaction(builtBytes)` on
    //     those exact bytes, sidesteps that.
    //
    // Verified end-to-end on Sui testnet 2026-08-20 with real Circle-issued testnet USDC:
    // gasUsed all-zero, sender's SUI balance unchanged before/after.
    async buildGaslessTx({ sender, recipient, coinType, amount }) {
      const { response: info } = await client.ledgerService.getServiceInfo({});
      if (!info.chainId) {
        throw new Error('getServiceInfo did not return a chainId — cannot build a ValidDuring expiration');
      }
      const currentEpoch = BigInt(info.epoch ?? 0);
      const chainId = info.chainId;

      const tx = new Transaction();
      tx.setSender(sender);
      const bal = tx.balance({ type: coinType, balance: amount });
      tx.moveCall({
        target: '0x2::balance::send_funds',
        typeArguments: [coinType],
        arguments: [bal, tx.pure.address(recipient)],
      });
      tx.setGasBudget(0);
      tx.setGasPrice(0);
      tx.setGasPayment([]);
      tx.setExpiration({
        ValidDuring: {
          minEpoch: String(currentEpoch),
          maxEpoch: String(currentEpoch + 1n),
          minTimestamp: null,
          maxTimestamp: null,
          chain: chainId,
          nonce: (Math.random() * 4294967296) >>> 0,
        },
      });

      const built = await tx.build({ client: client as unknown as never });
      const { bytes, signature } = await keypair.signTransaction(built);
      return { txBytesB64: bytes, senderSignatureB64: signature };
    },
  };
}
