import { jest } from '@jest/globals';
import { createFacilitatorClient, FacilitatorHttpError } from './client.js';
import type { FacilitatorRequestBody } from './types.js';

const body: FacilitatorRequestBody = {
  protocol: 'x402',
  paymentPayload: 'b64payload',
  paymentRequirements: 'b64requirements',
};

function mockFetch(response: { status: number; json: unknown }) {
  return jest.fn(async () => ({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: async () => response.json,
  })) as unknown as typeof fetch;
}

describe('createFacilitatorClient', () => {
  it('sends the x-api-key header and JSON body, and defaults baseUrl to https://api.thru.la', async () => {
    const fetchMock = mockFetch({ status: 200, json: { valid: true } });
    const client = createFacilitatorClient({ apiKey: 'thru_sk_test', fetch: fetchMock });

    const result = await client.verify(body);

    expect(result).toEqual({ valid: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.thru.la/v1/facilitator/verify');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('thru_sk_test');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it('honors a custom baseUrl', async () => {
    const fetchMock = mockFetch({ status: 200, json: { success: true, txHash: '0xabc' } });
    const client = createFacilitatorClient({
      apiKey: 'thru_sk_test',
      baseUrl: 'https://staging.thru.internal',
      fetch: fetchMock,
    });

    const result = await client.settle(body);

    expect(result).toEqual({ success: true, txHash: '0xabc' });
    const [url] = (fetchMock as jest.Mock).mock.calls[0];
    expect(url).toBe('https://staging.thru.internal/v1/facilitator/settle');
  });

  it('calls GET /v1/facilitator/supported for supported()', async () => {
    const fetchMock = mockFetch({ status: 200, json: { kinds: [] } });
    const client = createFacilitatorClient({ apiKey: 'thru_sk_test', fetch: fetchMock });

    const result = await client.supported();

    expect(result).toEqual({ kinds: [] });
    const [url, init] = (fetchMock as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.thru.la/v1/facilitator/supported');
    expect(init.method).toBe('GET');
  });

  it('throws FacilitatorHttpError on a non-2xx response', async () => {
    const fetchMock = mockFetch({ status: 401, json: { message: 'Invalid API key' } });
    const client = createFacilitatorClient({ apiKey: 'bad-key', fetch: fetchMock });

    await expect(client.verify(body)).rejects.toThrow(FacilitatorHttpError);
    await expect(client.verify(body)).rejects.toMatchObject({ status: 401 });
  });
});
