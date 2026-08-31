// Merchant-side counterpart to `./payer.js`'s `settleWithPayerGas`: independently confirm a
// payer-broadcast transaction actually paid what was priced, on-chain, before releasing the
// resource. Never trust a bare "here's a tx hash, I paid" claim — a resource server accepting
// that at face value is exactly the vulnerability x402/EIP-3009 payments exist to avoid.
//
// `ethers` is an optional peer dependency (see package.json) — only ever imported here, lazily,
// kept out of `client.ts` deliberately (that module is the "zero heavy deps... any WinterCG
// runtime" facilitator client every merchant using this SDK pulls in; this file is only for
// merchants who opted into the eip3009_exact payer-fallback path in the first place).

/** What the merchant itself priced this resource at — the same values used to build the original
 * `PaymentRequirements`/402 challenge, not anything taken from the payer's claim. */
export interface ExpectedPayment {
  /** Chain id the transaction must actually be on (e.g. 4663 for Robinhood mainnet) — a receipt
   * fetched from the wrong RPC endpoint proves nothing. */
  chainId: number;
  /** The token contract address (`requirements.asset`). */
  token: string;
  /** The merchant's own settlement address (`requirements.payTo`) — funds must have moved here. */
  to: string;
  /** Minimum amount, in the token's atomic units. */
  value: bigint;
  /** The authorization's nonce, from what the payer originally sent to `/v1/facilitator/settle` —
   * ties this specific on-chain event to the specific authorization that was priced, rather than
   * accepting any transfer of the right size to the right address as if it were this payment. */
  nonce: string;
}

export interface VerifyPayerBroadcastOptions {
  txHash: string;
  rpcUrl: string;
  expected: ExpectedPayment;
  /** Confirmations to require beyond inclusion. Default 1 (just "the receipt exists and
   * succeeded") — raise it if your resource server wants extra reorg safety before releasing
   * something irreversible on your end. */
  minConfirmations?: number;
}

export type VerifyPayerBroadcastResult =
  | { ok: true; from: string; confirmations: number }
  | {
      ok: false;
      reason:
        | 'wrong_chain'
        | 'receipt_not_found'
        | 'transaction_failed'
        | 'wrong_contract'
        | 'no_transfer_event'
        | 'wrong_recipient'
        | 'underpayment'
        | 'no_authorization_event'
        | 'nonce_mismatch'
        | 'insufficient_confirmations';
    };

interface ParsedLog {
  name: string;
  args: Record<string, unknown>;
}

interface Receipt {
  status: number | null;
  to: string | null;
  blockNumber: number | null;
  logs: unknown[];
}

/** Injectable — stubbed in unit tests so they never need a real RPC endpoint. Defaults to real
 * `ethers` calls in production (see `defaultDeps`). */
export interface VerifyPayerBroadcastDeps {
  chainId(): Promise<number>;
  transactionReceipt(txHash: string): Promise<Receipt | null>;
  blockNumber(): Promise<number>;
  /** Parse `receipt.logs` into whichever of Transfer/AuthorizationUsed they match; unrecognized
   * logs are simply absent from the result, not an error (a token may emit other events too). */
  parseLogs(logs: unknown[]): ParsedLog[];
}

const TRANSFER_EVENT = 'event Transfer(address indexed from, address indexed to, uint256 value)';
// Canonical EIP-3009 event (matches USDC and the wider ecosystem convention this SDK already
// assumes elsewhere — see eip3009-exact.scheme.ts's EIP3009_ABI on the facilitator side).
const AUTHORIZATION_USED_EVENT = 'event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)';

async function defaultDeps(rpcUrl: string): Promise<VerifyPayerBroadcastDeps> {
  const { JsonRpcProvider, Interface } = await import('ethers');
  const provider = new JsonRpcProvider(rpcUrl);
  const iface = new Interface([TRANSFER_EVENT, AUTHORIZATION_USED_EVENT]);
  return {
    chainId: async () => Number((await provider.getNetwork()).chainId),
    transactionReceipt: (txHash) => provider.getTransactionReceipt(txHash) as unknown as Promise<Receipt | null>,
    blockNumber: () => provider.getBlockNumber(),
    parseLogs: (logs) =>
      (logs as Parameters<typeof iface.parseLog>[0][])
        .map((log) => {
          try {
            return iface.parseLog(log);
          } catch {
            return null;
          }
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((p) => ({ name: p.name, args: p.args as unknown as Record<string, unknown> })),
  };
}

/**
 * Fetch the receipt for `txHash` and confirm, independently of anything the payer claims: it's on
 * the right chain, it succeeded, it called the right token contract, it actually transferred at
 * least the expected value to the merchant's own settlement address, and — the check that ties
 * this to the SPECIFIC authorization that was priced rather than any coincidentally-matching
 * transfer — the token's own `AuthorizationUsed` event names the expected nonce.
 *
 * Never throws for an on-chain/logical reason (a not-found receipt, a reverted transaction, a
 * mismatched field) — those are all `{ ok: false, reason }`. Only a genuine RPC/network failure
 * throws, since there's no sensible verification verdict to return in that case.
 */
export async function verifyPayerBroadcast(
  opts: VerifyPayerBroadcastOptions,
  deps?: VerifyPayerBroadcastDeps,
): Promise<VerifyPayerBroadcastResult> {
  const resolvedDeps = deps ?? (await defaultDeps(opts.rpcUrl));

  const chainId = await resolvedDeps.chainId();
  if (chainId !== opts.expected.chainId) {
    return { ok: false, reason: 'wrong_chain' };
  }

  const receipt = await resolvedDeps.transactionReceipt(opts.txHash);
  if (!receipt) {
    return { ok: false, reason: 'receipt_not_found' };
  }
  if (receipt.status !== 1) {
    return { ok: false, reason: 'transaction_failed' };
  }
  if (!receipt.to || receipt.to.toLowerCase() !== opts.expected.token.toLowerCase()) {
    return { ok: false, reason: 'wrong_contract' };
  }

  const parsed = resolvedDeps.parseLogs(receipt.logs);

  const transfer = parsed.find((p) => p.name === 'Transfer');
  if (!transfer) {
    return { ok: false, reason: 'no_transfer_event' };
  }
  const from = transfer.args.from as string;
  const to = transfer.args.to as string;
  const value = transfer.args.value as bigint;

  if (to.toLowerCase() !== opts.expected.to.toLowerCase()) {
    return { ok: false, reason: 'wrong_recipient' };
  }
  if (value < opts.expected.value) {
    return { ok: false, reason: 'underpayment' };
  }

  const authUsed = parsed.find((p) => p.name === 'AuthorizationUsed');
  if (!authUsed) {
    return { ok: false, reason: 'no_authorization_event' };
  }
  const usedNonce = authUsed.args.nonce as string;
  if (usedNonce.toLowerCase() !== opts.expected.nonce.toLowerCase()) {
    return { ok: false, reason: 'nonce_mismatch' };
  }

  const minConfirmations = opts.minConfirmations ?? 1;
  const currentBlock = await resolvedDeps.blockNumber();
  const confirmations = receipt.blockNumber === null ? 0 : currentBlock - receipt.blockNumber + 1;
  if (confirmations < minConfirmations) {
    return { ok: false, reason: 'insufficient_confirmations' };
  }

  return { ok: true, from, confirmations };
}
