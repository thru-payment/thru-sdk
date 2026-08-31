// Payer-side fallback for `eip3009_exact`: broadcast an already-signed EIP-3009 authorization
// directly against the token contract, bypassing Thru's relayer entirely.
//
// This exists for exactly one situation: the resource server's `settle()` call came back with
// `{ success: false, reason: 'gas_tank_empty', settlementState: 'not_broadcast' }` (or the
// merchant checked `GET /v1/facilitator/supported` and saw `extra.gasReady === false` up front).
// `settlementState: 'not_broadcast'` is a hard guarantee from the facilitator, not a best-effort
// guess (see `../../../apps/api/src/facilitator/protocols/normalized.types.ts`'s doc comment on
// that field) — it is the ONLY condition under which this module is safe to use. Never call this
// after a timeout or any other ambiguous outcome: the facilitator may already have broadcast the
// transaction, and a second submission of the same `nonce` would either double-spend-attempt
// (harmlessly reverted by the token contract's own replay protection) or, worse, race a
// legitimate in-flight submission in a way this SDK cannot see.
//
// Why this only exists for `eip3009_exact`: a Permit2-signed `PermitTransferFrom` names Thru's
// relayer as the exact `spender`, and Permit2's contract checks `msg.sender === spender` before
// honoring it — literally no other address can submit it. An EIP-3009 `transferWithAuthorization`
// signature has no such binding (that is the whole point of the standard): the token contract
// verifies the signature itself and moves funds accordingly no matter who calls it. That is what
// makes a payer-funded broadcast possible here and nowhere else in this SDK.
//
// `ethers` is an optional peer dependency (see package.json) — only ever imported here, lazily,
// exactly like `testing/agent-client.ts`.

/** The exact fields the payer originally signed and sent to the facilitator — reuse them
 * verbatim, never re-derive or re-sign. A fresh signature would carry a different `nonce`/
 * `validBefore`, which is a DIFFERENT authorization as far as both the facilitator and the token
 * contract are concerned, not a retry of the one that just failed to broadcast. */
export interface Eip3009Authorization {
  token: string;
  from: string;
  to: string;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  /** bytes32 hex. */
  nonce: string;
  /** Packed r+s+v signature — the exact value sent as `payload.signature` to the facilitator. */
  signature: string;
}

/** Minimal shape this module needs from an ethers `Signer` (a real `ethers.Signer` satisfies
 * this) — declared locally rather than importing the `ethers` type so this file only pulls in the
 * real `ethers` module at runtime (inside `defaultDeps`), not at import time. */
export interface EvmSignerLike {
  getAddress(): Promise<string>;
}

export type Eip3009WriteContract = {
  transferWithAuthorization(
    from: string,
    to: string,
    value: bigint,
    validAfter: bigint,
    validBefore: bigint,
    nonce: string,
    v: number,
    r: string,
    s: string,
  ): Promise<{ hash: string; wait(confirmations?: number): Promise<{ status: number | null; hash: string } | null> }>;
};

/** Injectable — stubbed in unit tests so they never need a real signer/provider/network. Defaults
 * to real `ethers` calls in production (see `defaultDeps`). */
export interface SettleWithPayerGasDeps {
  contract(token: string, signer: EvmSignerLike): Eip3009WriteContract;
  splitSignature(signature: string): Promise<{ v: number; r: string; s: string }>;
}

export interface SettleWithPayerGasOptions {
  /** The already-signed authorization from the ORIGINAL payment attempt (see this file's header
   * comment on why it must be reused, not re-signed). */
  authorization: Eip3009Authorization;
  /**
   * The wallet that will pay gas for the broadcast — normally the payer's own connected wallet
   * (e.g. `await new BrowserProvider(window.ethereum).getSigner()`), so their wallet UI prompts
   * them to confirm a real transaction before anything is spent. This SDK never constructs or
   * auto-approves that confirmation itself — pass a signer only at the point your own UI has
   * explicit user consent to spend their gas; do not wire this into automatic retry logic.
   *
   * Must control `authorization.from` — enforced below, since submitting with any other signer
   * cannot succeed anyway (the token contract recovers the signer from `authorization.signature`
   * and checks it against `authorization.from` itself) but failing fast with a clear message here
   * is more useful than a generic on-chain revert.
   */
  signer: EvmSignerLike;
}

export interface SettleWithPayerGasResult {
  txHash: string;
}

async function defaultDeps(): Promise<SettleWithPayerGasDeps> {
  const { Contract, Signature } = await import('ethers');
  const EIP3009_ABI = [
    'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external',
  ];
  return {
    contract: (token, signer) => new Contract(token, EIP3009_ABI, signer as unknown as never) as unknown as Eip3009WriteContract,
    splitSignature: async (signature) => Signature.from(signature),
  };
}

/**
 * Broadcast an already-signed EIP-3009 `transferWithAuthorization` directly against the token
 * contract, using the payer's own wallet to pay gas — the facilitator's relayer is never
 * contacted. See this file's header comment for exactly when this is safe to call.
 *
 * Throws (never returns a `{success:false}`-shaped value) on any failure — a thrown transaction
 * from here on IS a broadcast attempt from the token contract's perspective (it may have reverted,
 * or the wallet may have rejected signing it), so unlike the facilitator's own SettleResult there
 * is no "was anything sent" ambiguity left for a caller to resolve: either this resolves with a
 * real `txHash` from a receipt with `status === 1`, or it throws.
 */
export async function settleWithPayerGas(
  opts: SettleWithPayerGasOptions,
  deps?: SettleWithPayerGasDeps,
): Promise<SettleWithPayerGasResult> {
  const { authorization, signer } = opts;

  const signerAddress = await signer.getAddress();
  if (signerAddress.toLowerCase() !== authorization.from.toLowerCase()) {
    throw new Error(
      `settleWithPayerGas: signer address ${signerAddress} does not match authorization.from ` +
        `${authorization.from} — this signer cannot broadcast someone else's authorization.`,
    );
  }

  const resolvedDeps = deps ?? (await defaultDeps());
  const { v, r, s } = await resolvedDeps.splitSignature(authorization.signature);
  const contract = resolvedDeps.contract(authorization.token, signer);

  const tx = await contract.transferWithAuthorization(
    authorization.from,
    authorization.to,
    authorization.value,
    authorization.validAfter,
    authorization.validBefore,
    authorization.nonce,
    v,
    r,
    s,
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`settleWithPayerGas: transaction ${tx.hash} did not succeed (receipt status ${receipt?.status ?? 'unknown'})`);
  }
  return { txHash: receipt.hash ?? tx.hash };
}
