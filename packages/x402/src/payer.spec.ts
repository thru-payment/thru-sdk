import { jest } from '@jest/globals';
import { settleWithPayerGas, type Eip3009Authorization, type SettleWithPayerGasDeps } from './payer.js';

const PAYER = '0x1111111111111111111111111111111111111111';
const MERCHANT = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';

function baseAuthorization(): Eip3009Authorization {
  return {
    token: TOKEN,
    from: PAYER,
    to: MERCHANT,
    value: 5_000000n,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 300),
    nonce: '0x' + '01'.repeat(32),
    signature: '0x' + '00'.repeat(65),
  };
}

function signerFor(address: string) {
  return { getAddress: async () => address };
}

describe('settleWithPayerGas', () => {
  it('broadcasts transferWithAuthorization with the exact signed fields and returns the tx hash', async () => {
    const transferWithAuthorization = jest.fn().mockResolvedValue({
      hash: '0xTXHASH',
      wait: jest.fn().mockResolvedValue({ status: 1, hash: '0xTXHASH' }),
    });
    const deps: SettleWithPayerGasDeps = {
      contract: () => ({ transferWithAuthorization }),
      splitSignature: async () => ({ v: 27, r: '0x' + 'aa'.repeat(32), s: '0x' + 'bb'.repeat(32) }),
    };

    const authorization = baseAuthorization();
    const result = await settleWithPayerGas({ authorization, signer: signerFor(PAYER) }, deps);

    expect(result).toEqual({ txHash: '0xTXHASH' });
    expect(transferWithAuthorization).toHaveBeenCalledWith(
      authorization.from,
      authorization.to,
      authorization.value,
      authorization.validAfter,
      authorization.validBefore,
      authorization.nonce,
      27,
      '0x' + 'aa'.repeat(32),
      '0x' + 'bb'.repeat(32),
    );
  });

  it('refuses to broadcast when the signer does not control authorization.from, without touching the chain', async () => {
    const transferWithAuthorization = jest.fn();
    const deps: SettleWithPayerGasDeps = {
      contract: () => ({ transferWithAuthorization }),
      splitSignature: async () => ({ v: 27, r: '0x' + '00'.repeat(32), s: '0x' + '00'.repeat(32) }),
    };

    const authorization = baseAuthorization();
    // A different wallet than authorization.from — e.g. the caller wired up the wrong signer.
    const wrongSigner = signerFor('0x9999999999999999999999999999999999999999');

    await expect(settleWithPayerGas({ authorization, signer: wrongSigner }, deps)).rejects.toThrow(
      /does not match authorization\.from/,
    );
    expect(transferWithAuthorization).not.toHaveBeenCalled();
  });

  it('matches signer/authorization.from case-insensitively (checksum vs lowercase)', async () => {
    const transferWithAuthorization = jest.fn().mockResolvedValue({
      hash: '0xTXHASH',
      wait: jest.fn().mockResolvedValue({ status: 1, hash: '0xTXHASH' }),
    });
    const deps: SettleWithPayerGasDeps = {
      contract: () => ({ transferWithAuthorization }),
      splitSignature: async () => ({ v: 27, r: '0x' + '00'.repeat(32), s: '0x' + '00'.repeat(32) }),
    };

    const authorization = { ...baseAuthorization(), from: PAYER.toUpperCase().replace('0X', '0x') };
    const result = await settleWithPayerGas({ authorization, signer: signerFor(PAYER.toLowerCase()) }, deps);
    expect(result.txHash).toBe('0xTXHASH');
  });

  it('throws when the transaction is broadcast but the receipt reports failure', async () => {
    const transferWithAuthorization = jest.fn().mockResolvedValue({
      hash: '0xTXHASH',
      wait: jest.fn().mockResolvedValue({ status: 0, hash: '0xTXHASH' }),
    });
    const deps: SettleWithPayerGasDeps = {
      contract: () => ({ transferWithAuthorization }),
      splitSignature: async () => ({ v: 27, r: '0x' + '00'.repeat(32), s: '0x' + '00'.repeat(32) }),
    };

    const authorization = baseAuthorization();
    await expect(settleWithPayerGas({ authorization, signer: signerFor(PAYER) }, deps)).rejects.toThrow(
      /did not succeed/,
    );
  });
});
