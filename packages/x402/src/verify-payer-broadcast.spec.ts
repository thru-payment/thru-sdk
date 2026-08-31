import { verifyPayerBroadcast, type ExpectedPayment, type VerifyPayerBroadcastDeps } from './verify-payer-broadcast.js';

const TOKEN = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const PAYER = '0x1111111111111111111111111111111111111111';
const MERCHANT = '0x2222222222222222222222222222222222222222';
const NONCE = '0x' + '01'.repeat(32);
const CHAIN_ID = 4663; // Robinhood mainnet

function expectedPayment(overrides: Partial<ExpectedPayment> = {}): ExpectedPayment {
  return { chainId: CHAIN_ID, token: TOKEN, to: MERCHANT, value: 5_000000n, nonce: NONCE, ...overrides };
}

/** A deps stub that reports a fully successful, matching broadcast — individual tests override
 * just the one thing they're checking, matching the rest of this codebase's `alwaysOkDeps()`
 * convention. */
function happyDeps(overrides: Partial<VerifyPayerBroadcastDeps> = {}): VerifyPayerBroadcastDeps {
  return {
    chainId: async () => CHAIN_ID,
    transactionReceipt: async () => ({ status: 1, to: TOKEN, blockNumber: 100, logs: [] }),
    blockNumber: async () => 100,
    parseLogs: () => [
      { name: 'Transfer', args: { from: PAYER, to: MERCHANT, value: 5_000000n } },
      { name: 'AuthorizationUsed', args: { authorizer: PAYER, nonce: NONCE } },
    ],
    ...overrides,
  };
}

describe('verifyPayerBroadcast', () => {
  it('confirms a matching broadcast: right chain, contract, recipient, amount, and nonce', async () => {
    const result = await verifyPayerBroadcast(
      { txHash: '0xTX', rpcUrl: 'http://localhost', expected: expectedPayment() },
      happyDeps(),
    );
    expect(result).toEqual({ ok: true, from: PAYER, confirmations: 1 });
  });

  it('accepts an overpayment (value >= expected, not ===)', async () => {
    const deps = happyDeps({
      parseLogs: () => [
        { name: 'Transfer', args: { from: PAYER, to: MERCHANT, value: 6_000000n } },
        { name: 'AuthorizationUsed', args: { authorizer: PAYER, nonce: NONCE } },
      ],
    });
    const result = await verifyPayerBroadcast(
      { txHash: '0xTX', rpcUrl: 'http://localhost', expected: expectedPayment() },
      deps,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a receipt fetched from the wrong chain', async () => {
    const result = await verifyPayerBroadcast(
      { txHash: '0xTX', rpcUrl: 'http://localhost', expected: expectedPayment() },
      happyDeps({ chainId: async () => 56 }),
    );
    expect(result).toEqual({ ok: false, reason: 'wrong_chain' });
  });

  it('reports receipt_not_found rather than throwing when the tx is unknown/pending', async () => {
    const result = await verifyPayerBroadcast(
      { txHash: '0xTX', rpcUrl: 'http://localhost', expected: expectedPayment() },
      happyDeps({ transactionReceipt: async () => null }),
    );
    expect(result).toEqual({ ok: false, reason: 'receipt_not_found' });
  });

  it('rejects a reverted transaction', async () => {
    const result = await verifyPayerBroadcast(
      { txHash: '0xTX', rpcUrl: 'http://localhost', expected: expectedPayment() },
      happyDeps({ transactionReceipt: async () => ({ status: 0, to: TOKEN, blockNumber: 100, logs: [] }) }),
    );
    expect(result).toEqual({ ok: false, reason: 'transaction_failed' });
  });

  it('rejects a receipt against the wrong contract', async () => {
    const result = await verifyPayerBroadcast(
      { txHash: '0xTX', rpcUrl: 'http://localhost', expected: expectedPayment() },
      happyDeps({ transactionReceipt: async () => ({ status: 1, to: '0x9999999999999999999999999999999999999999', blockNumber: 100, logs: [] }) }),
    );
    expect(result).toEqual({ ok: false, reason: 'wrong_contract' });
  });

  it('rejects when no Transfer event is present in the logs', async () => {
    const result = await verifyPayerBroadcast(
      { txHash: '0xTX', rpcUrl: 'http://localhost', expected: expectedPayment() },
      happyDeps({ parseLogs: () => [{ name: 'AuthorizationUsed', args: { authorizer: PAYER, nonce: NONCE } }] }),
    );
    expect(result).toEqual({ ok: false, reason: 'no_transfer_event' });
  });

  it('rejects a transfer to the wrong recipient (not the merchant\'s own settlement address)', async () => {
    const deps = happyDeps({
      parseLogs: () => [
        { name: 'Transfer', args: { from: PAYER, to: '0x9999999999999999999999999999999999999999', value: 5_000000n } },
        { name: 'AuthorizationUsed', args: { authorizer: PAYER, nonce: NONCE } },
      ],
    });
    const result = await verifyPayerBroadcast({ txHash: '0xTX', rpcUrl: 'http://localhost', expected: expectedPayment() }, deps);
    expect(result).toEqual({ ok: false, reason: 'wrong_recipient' });
  });

  it('rejects an underpayment', async () => {
    const deps = happyDeps({
      parseLogs: () => [
        { name: 'Transfer', args: { from: PAYER, to: MERCHANT, value: 1_000000n } },
        { name: 'AuthorizationUsed', args: { authorizer: PAYER, nonce: NONCE } },
      ],
    });
    const result = await verifyPayerBroadcast({ txHash: '0xTX', rpcUrl: 'http://localhost', expected: expectedPayment() }, deps);
    expect(result).toEqual({ ok: false, reason: 'underpayment' });
  });

  it('rejects when no AuthorizationUsed event is present — a Transfer alone does not prove which authorization it was', async () => {
    const deps = happyDeps({ parseLogs: () => [{ name: 'Transfer', args: { from: PAYER, to: MERCHANT, value: 5_000000n } }] });
    const result = await verifyPayerBroadcast({ txHash: '0xTX', rpcUrl: 'http://localhost', expected: expectedPayment() }, deps);
    expect(result).toEqual({ ok: false, reason: 'no_authorization_event' });
  });

  it('rejects a nonce that does not match the priced authorization', async () => {
    const deps = happyDeps({
      parseLogs: () => [
        { name: 'Transfer', args: { from: PAYER, to: MERCHANT, value: 5_000000n } },
        { name: 'AuthorizationUsed', args: { authorizer: PAYER, nonce: '0x' + '02'.repeat(32) } },
      ],
    });
    const result = await verifyPayerBroadcast({ txHash: '0xTX', rpcUrl: 'http://localhost', expected: expectedPayment() }, deps);
    expect(result).toEqual({ ok: false, reason: 'nonce_mismatch' });
  });

  it('rejects when the caller requires more confirmations than the chain currently has', async () => {
    const deps = happyDeps({ blockNumber: async () => 100 }); // receipt.blockNumber is 100 too -> 1 confirmation
    const result = await verifyPayerBroadcast(
      { txHash: '0xTX', rpcUrl: 'http://localhost', expected: expectedPayment(), minConfirmations: 3 },
      deps,
    );
    expect(result).toEqual({ ok: false, reason: 'insufficient_confirmations' });
  });

  it('passes once enough blocks have landed on top of the receipt', async () => {
    const deps = happyDeps({ blockNumber: async () => 102 }); // receipt at 100, chain tip at 102 -> 3 confirmations
    const result = await verifyPayerBroadcast(
      { txHash: '0xTX', rpcUrl: 'http://localhost', expected: expectedPayment(), minConfirmations: 3 },
      deps,
    );
    expect(result).toEqual({ ok: true, from: PAYER, confirmations: 3 });
  });
});
