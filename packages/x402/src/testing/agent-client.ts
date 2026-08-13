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

const CHAIN_ID_BY_NETWORK: Record<'mainnet' | 'testnet', number> = {
  mainnet: 56,
  testnet: 97,
};

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
];

export type EvmAgentOptions = { kind: 'evm'; privateKey: string; rpcUrl: string };
export type SuiAgentOptions = {
  kind: 'sui';
  keypairSeed: string;
  rpcUrl: string;
  sponsorAddress: string;
};

export interface TestAgent {
  fetchWithPayment(url: string, init?: RequestInit): Promise<Response>;
}

/** Injectable EVM dependencies — real ethers calls by default, stubbed in unit tests. */
export interface EvmAgentDeps {
  fetch: typeof fetch;
  /** Ensure the payer has approved Permit2 for at least `amount` of `token` (one-time approve). */
  ensureAllowance(input: { token: string; owner: string; amount: bigint }): Promise<void>;
  /** Resolve the Permit2 `spender` address (Thru's relayer) for the target resource server. */
  spenderFor(url: string, requirements: RouteRequirements): Promise<string>;
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

      const deps = injectedDeps ?? (await defaultEvmDeps(opts));
      const spender = await deps.spenderFor(url, requirements);

      await deps.ensureAllowance({
        token: requirements.asset,
        owner: await evmAddress(opts.privateKey),
        amount: requirements.amountAtomic,
      });

      const nonce = randomUint256();
      const deadline = BigInt(Math.floor(Date.now() / 1000) + requirements.maxTimeoutSeconds);

      const signature = await signPermit(opts.privateKey, {
        token: requirements.asset,
        amount: requirements.amountAtomic,
        spender,
        nonce,
        deadline,
        chainId: CHAIN_ID_BY_NETWORK[requirements.network],
      });

      const payer = await evmAddress(opts.privateKey);
      const envelope = {
        x402Version: 2,
        scheme: 'permit2_exact',
        network: requirements.network === 'mainnet' ? 'eip155:56' : 'eip155:97',
        payload: {
          permit: {
            token: requirements.asset,
            amount: requirements.amountAtomic.toString(),
            nonce: nonce.toString(),
            deadline: deadline.toString(),
          },
          transferTo: requirements.payTo,
          signature,
          payer,
        },
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

async function defaultEvmDeps(opts: EvmAgentOptions): Promise<EvmAgentDeps> {
  const { Contract, JsonRpcProvider, Wallet } = await import('ethers');
  const provider = new JsonRpcProvider(opts.rpcUrl);
  const wallet = new Wallet(opts.privateKey, provider);

  return {
    fetch,
    async spenderFor(url: string): Promise<string> {
      // Ask the resource server's Thru facilitator for the current relayer address via
      // `/v1/facilitator/supported` on the same origin as the resource, per spec §7's
      // `extra.spender`. E2E callers typically inject a deps override that already knows the
      // relayer address instead of relying on this default.
      const origin = new URL(url).origin;
      const response = await fetch(`${origin}/v1/facilitator/supported`);
      if (!response.ok) {
        throw new Error(`Failed to look up facilitator spender: HTTP ${response.status}`);
      }
      const body = (await response.json()) as {
        kinds: Array<{ chain: string; extra?: { spender?: string | null } }>;
      };
      const kind = body.kinds.find((k) => k.chain === 'bnb' && k.extra?.spender);
      if (!kind?.extra?.spender) {
        throw new Error('No BNB permit2 spender advertised by /v1/facilitator/supported');
      }
      return kind.extra.spender;
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
// Sui (sponsored transaction)
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

      const { txBytesB64, senderSignatureB64 } = await deps.buildSponsoredTx({
        sender,
        gasOwner: opts.sponsorAddress,
        recipient: requirements.payTo,
        coinType: requirements.asset,
        amount: requirements.amountAtomic,
      });

      const envelope = {
        x402Version: 2,
        scheme: 'sui_sponsored',
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
  const { SuiJsonRpcClient } = await import('@mysten/sui/jsonRpc');
  const { Transaction, coinWithBalance } = await import('@mysten/sui/transactions');
  const network = opts.rpcUrl.includes('mainnet') ? 'mainnet' : 'testnet';
  const client = new SuiJsonRpcClient({ url: opts.rpcUrl, network });
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
  };
}
