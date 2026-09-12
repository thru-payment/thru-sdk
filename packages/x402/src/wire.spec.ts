// Wire-format lock. Everything in this file is a GOLDEN VECTOR: a known input and the exact
// base64 string it must encode to.
//
// These are not style assertions. The facilitator in the sibling repo
// (`apps/api/src/facilitator/protocols/x402.codec.ts`) decodes these exact bytes, and the field
// order inside the envelope feeds authHash derivation and EIP-712 digests there. A refactor that
// renames a field, reorders two keys, or drops `extra: {}` when nothing was configured produces an
// envelope that still round-trips inside this SDK and still "looks fine" — and that no longer
// verifies against the facilitator. That failure mode is the reason these literals are checked in.
//
// If a test here fails, the fix is almost never "update the expected string". It is "put the
// encoder back". Changing a vector deliberately means changing `x402.codec.ts` in lockstep and
// coordinating with every already-published integrator.

import { gateRequest } from './middleware.js';
import { buildChallengeHeaders, decodeRequirementsFromHeader } from './challenge.js';
import {
  X402_VERSION,
  encodePaymentEnvelope,
  encodeRequirementsEnvelope,
  encodeSettleResponseEnvelope,
} from './wire.js';
import type { FacilitatorClient, RouteRequirements, SettleResponseBody } from './index.js';

function decode(b64: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Record<string, unknown>;
}

// --------------------------------------------------------------------------------------------
// PAYMENT-REQUIRED / paymentRequirements envelope
// --------------------------------------------------------------------------------------------

const BNB_ROUTE: RouteRequirements = {
  scheme: 'permit2_exact',
  chain: 'bnb',
  network: 'mainnet',
  asset: '0x55d398326f99059ff775485246999027b3197955',
  amountAtomic: 5000000000000000000n,
  payTo: '0xMERCHANT',
  resource: 'https://api.example.com/report',
  maxTimeoutSeconds: 300,
};

const BNB_ROUTE_B64 =
  'eyJwcm90b2NvbCI6Ing0MDIiLCJzY2hlbWUiOiJwZXJtaXQyX2V4YWN0IiwiY2hhaW4iOiJibmIiLCJuZXR3b3JrIjoi' +
  'bWFpbm5ldCIsImFzc2V0IjoiMHg1NWQzOTgzMjZmOTkwNTlmZjc3NTQ4NTI0Njk5OTAyN2IzMTk3OTU1IiwiYW1vdW50' +
  'QXRvbWljIjoiNTAwMDAwMDAwMDAwMDAwMDAwMCIsInBheVRvIjoiMHhNRVJDSEFOVCIsInJlc291cmNlIjoiaHR0cHM6' +
  'Ly9hcGkuZXhhbXBsZS5jb20vcmVwb3J0IiwibWF4VGltZW91dFNlY29uZHMiOjMwMCwiZXh0cmEiOnt9fQ==';

const SUI_ROUTE: RouteRequirements = {
  scheme: 'sui_direct',
  chain: 'sui',
  network: 'testnet',
  asset: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
  amountAtomic: 1000000n,
  payTo: '0xMERCHANTSUI',
  resource: 'https://api.example.com/report',
  maxTimeoutSeconds: 120,
  extra: { gasOwner: '0xSPONSOR' },
};

const SUI_ROUTE_B64 =
  'eyJwcm90b2NvbCI6Ing0MDIiLCJzY2hlbWUiOiJzdWlfZGlyZWN0IiwiY2hhaW4iOiJzdWkiLCJuZXR3b3JrIjoidGVz' +
  'dG5ldCIsImFzc2V0IjoiMHhhMWVjN2ZjMDBhNmY0MGRiOTY5M2FkMTQxNWQwYzE5M2FkMzkwNjQ5NDQyOGNmMjUyNjIx' +
  'MDM3YmQ3MTE3ZTI5Ojp1c2RjOjpVU0RDIiwiYW1vdW50QXRvbWljIjoiMTAwMDAwMCIsInBheVRvIjoiMHhNRVJDSEFO' +
  'VFNVSSIsInJlc291cmNlIjoiaHR0cHM6Ly9hcGkuZXhhbXBsZS5jb20vcmVwb3J0IiwibWF4VGltZW91dFNlY29uZHMi' +
  'OjEyMCwiZXh0cmEiOnsiZ2FzT3duZXIiOiIweFNQT05TT1IifX0=';

describe('requirements envelope — golden vectors', () => {
  it('encodes a BNB permit2 route to exactly the pinned base64', () => {
    expect(encodeRequirementsEnvelope(BNB_ROUTE)).toBe(BNB_ROUTE_B64);
  });

  it('encodes a Sui route (with `extra`) to exactly the pinned base64', () => {
    expect(encodeRequirementsEnvelope(SUI_ROUTE)).toBe(SUI_ROUTE_B64);
  });

  it('decodes to the exact JSON text the facilitator parses', () => {
    // Spelled out rather than compared structurally: `JSON.parse` throws key order away, and key
    // order is part of what is being pinned here.
    expect(Buffer.from(BNB_ROUTE_B64, 'base64').toString('utf8')).toBe(
      '{"protocol":"x402","scheme":"permit2_exact","chain":"bnb","network":"mainnet",' +
        '"asset":"0x55d398326f99059ff775485246999027b3197955",' +
        '"amountAtomic":"5000000000000000000","payTo":"0xMERCHANT",' +
        '"resource":"https://api.example.com/report","maxTimeoutSeconds":300,"extra":{}}',
    );
  });

  it('pins the field order `x402.codec.ts#decodeRequirements` reads', () => {
    expect(Object.keys(decode(BNB_ROUTE_B64))).toEqual([
      'protocol',
      'scheme',
      'chain',
      'network',
      'asset',
      'amountAtomic',
      'payTo',
      'resource',
      'maxTimeoutSeconds',
      'extra',
    ]);
  });

  it('always emits `protocol: "x402"`, even for a route settled over MPP', () => {
    // The facilitator decodes `paymentRequirements` with `decodeRequirements` whichever protocol
    // carried the payment itself, so this field is not the payment's protocol.
    expect(decode(encodeRequirementsEnvelope(SUI_ROUTE)).protocol).toBe('x402');
  });

  it('serializes amountAtomic as a decimal STRING, never a JSON number', () => {
    // A bigint above 2^53 silently loses precision as a JSON number; the facilitator's
    // `BigInt(amountAtomic)` expects the string form.
    const decoded = decode(BNB_ROUTE_B64);
    expect(typeof decoded.amountAtomic).toBe('string');
    expect(decoded.amountAtomic).toBe('5000000000000000000');
  });

  it('emits `extra: {}` rather than omitting the key when the route has no extra', () => {
    expect(decode(BNB_ROUTE_B64)).toHaveProperty('extra', {});
  });

  it('round-trips through decodeRequirementsFromHeader', () => {
    const decoded = decodeRequirementsFromHeader(BNB_ROUTE_B64);
    expect(decoded).toEqual({ protocol: 'x402', ...BNB_ROUTE, extra: {} });
    expect(encodeRequirementsEnvelope(decoded)).toBe(BNB_ROUTE_B64);
  });
});

describe('requirements envelope — one encoder, every call site', () => {
  // The challenge header and the facilitator request body used to be built from two separate
  // copies of this envelope. They must be the same bytes: the facilitator matches the payment
  // against the requirements it is handed, and a merchant who advertised one thing and submitted
  // another gets a rejection that points nowhere useful.

  it('buildChallengeHeaders emits the pinned bytes in PAYMENT-REQUIRED', () => {
    expect(buildChallengeHeaders(BNB_ROUTE)['PAYMENT-REQUIRED']).toBe(BNB_ROUTE_B64);
  });

  it('gateRequest sends those same bytes as paymentRequirements to verify AND to settle', async () => {
    const seen: string[] = [];
    const client = {
      verify: async (body: { paymentRequirements: string }) => {
        seen.push(body.paymentRequirements);
        return { valid: true };
      },
      settle: async (body: { paymentRequirements: string }): Promise<SettleResponseBody> => {
        seen.push(body.paymentRequirements);
        return { success: true, txHash: '0xTX' };
      },
      supported: async () => ({ kinds: [] }),
    } as unknown as FacilitatorClient;

    await gateRequest({ 'PAYMENT-SIGNATURE': 'envelope' }, BNB_ROUTE, client);
    await gateRequest({ 'PAYMENT-SIGNATURE': 'envelope' }, BNB_ROUTE, client, { verifyOnly: true });

    expect(seen).toEqual([BNB_ROUTE_B64, BNB_ROUTE_B64]);
  });
});

// --------------------------------------------------------------------------------------------
// PAYMENT-SIGNATURE envelope
// --------------------------------------------------------------------------------------------

describe('payment envelope — golden vectors', () => {
  it('encodes a permit2 payment to exactly the pinned base64', () => {
    expect(
      encodePaymentEnvelope({
        scheme: 'permit2_exact',
        network: 'eip155:97',
        payload: {
          permit: { token: '0xTOKEN', amount: '1000000', nonce: '42', deadline: '1700000000' },
          transferTo: '0xMERCHANT',
          signature: '0xSIG',
          payer: '0xPAYER',
        },
      }),
    ).toBe(
      'eyJ4NDAyVmVyc2lvbiI6Miwic2NoZW1lIjoicGVybWl0Ml9leGFjdCIsIm5ldHdvcmsiOiJlaXAxNTU6OTciLCJw' +
        'YXlsb2FkIjp7InBlcm1pdCI6eyJ0b2tlbiI6IjB4VE9LRU4iLCJhbW91bnQiOiIxMDAwMDAwIiwibm9uY2UiOiI0' +
        'MiIsImRlYWRsaW5lIjoiMTcwMDAwMDAwMCJ9LCJ0cmFuc2ZlclRvIjoiMHhNRVJDSEFOVCIsInNpZ25hdHVyZSI6' +
        'IjB4U0lHIiwicGF5ZXIiOiIweFBBWUVSIn19',
    );
  });

  it('encodes a Sui payment to exactly the pinned base64', () => {
    expect(
      encodePaymentEnvelope({
        scheme: 'sui_direct',
        network: 'sui:testnet',
        payload: {
          txBytesB64: 'dHhieXRlcw==',
          senderSignatureB64: 'c2lnbmF0dXJl',
          payer: '0xPAYERSUI',
        },
      }),
    ).toBe(
      'eyJ4NDAyVmVyc2lvbiI6Miwic2NoZW1lIjoic3VpX2RpcmVjdCIsIm5ldHdvcmsiOiJzdWk6dGVzdG5ldCIsInBh' +
        'eWxvYWQiOnsidHhCeXRlc0I2NCI6ImRIaGllWFJsY3c9PSIsInNlbmRlclNpZ25hdHVyZUI2NCI6ImMybG5ibUYw' +
        'ZFhKbCIsInBheWVyIjoiMHhQQVlFUlNVSSJ9fQ==',
    );
  });

  it('pins the envelope field order and the x402 version number', () => {
    const b64 = encodePaymentEnvelope({ scheme: 'sui_direct', network: 'sui:testnet', payload: {} });
    expect(Object.keys(decode(b64))).toEqual(['x402Version', 'scheme', 'network', 'payload']);
    expect(decode(b64).x402Version).toBe(2);
    expect(X402_VERSION).toBe(2);
  });
});

// --------------------------------------------------------------------------------------------
// PAYMENT-RESPONSE envelope
// --------------------------------------------------------------------------------------------

describe('settle-response envelope — golden vectors', () => {
  it('encodes a settled payment to exactly the pinned base64', () => {
    expect(encodeSettleResponseEnvelope({ success: true, txHash: '0xTX', network: 'mainnet' })).toBe(
      'eyJzdWNjZXNzIjp0cnVlLCJ0eEhhc2giOiIweFRYIiwibmV0d29yayI6Im1haW5uZXQifQ==',
    );
  });

  it('omits txHash entirely when there is none (verify-only, or a settle with no hash)', () => {
    const expected = 'eyJzdWNjZXNzIjp0cnVlLCJuZXR3b3JrIjoibWFpbm5ldCJ9';
    expect(encodeSettleResponseEnvelope({ success: true, network: 'mainnet' })).toBe(expected);
    expect(encodeSettleResponseEnvelope({ success: true, txHash: undefined, network: 'mainnet' })).toBe(
      expected,
    );
  });

  it('is what gateRequest actually puts on the PAYMENT-RESPONSE header', async () => {
    const client = {
      verify: async () => ({ valid: true }),
      settle: async (): Promise<SettleResponseBody> => ({ success: true, txHash: '0xTX' }),
      supported: async () => ({ kinds: [] }),
    } as unknown as FacilitatorClient;

    const settled = await gateRequest({ 'PAYMENT-SIGNATURE': 'envelope' }, BNB_ROUTE, client);
    if (settled.kind !== 'proceed') throw new Error('expected proceed');
    expect(settled.responseHeaders['PAYMENT-RESPONSE']).toBe(
      'eyJzdWNjZXNzIjp0cnVlLCJ0eEhhc2giOiIweFRYIiwibmV0d29yayI6Im1haW5uZXQifQ==',
    );

    const verified = await gateRequest({ 'PAYMENT-SIGNATURE': 'envelope' }, BNB_ROUTE, client, {
      verifyOnly: true,
    });
    if (verified.kind !== 'proceed') throw new Error('expected proceed');
    expect(verified.responseHeaders['PAYMENT-RESPONSE']).toBe(
      'eyJzdWNjZXNzIjp0cnVlLCJuZXR3b3JrIjoibWFpbm5ldCJ9',
    );
  });
});
