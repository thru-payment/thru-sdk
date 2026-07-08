# Errors & retries

Every failure throws a typed error. Import and branch on the class you care about.

```ts
import {
  ThruError,           // base class for everything the SDK throws
  ThruAPIError,        // any non-2xx response (base for the ones below)
  ThruValidationError, // 400 / 422 — the request was invalid
  ThruAuthError,       // 401 / 403 — bad or insufficient credentials
  ThruNotFoundError,   // 404
  ThruConflictError,   // 409 — conflicts with current state (e.g. already refunded)
  ThruRateLimitError,  // 429
  ThruConnectionError, // network failure or timeout
} from 'thru-sdk';

try {
  await thru.payments.create({ chain: 'base', token: 'USDC', amount: '25', currency: 'USD' });
} catch (err) {
  if (err instanceof ThruValidationError) {
    console.error('Invalid request:', err.message, err.body);
  } else if (err instanceof ThruRateLimitError) {
    // back off and retry later
  } else if (err instanceof ThruAPIError) {
    console.error(err.status, err.code, err.requestId); // include requestId in support tickets
  } else if (err instanceof ThruConnectionError) {
    // network / timeout
  }
}
```

Every `ThruAPIError` carries:

- `status` — the HTTP status code
- `code` — the machine-readable error code (when the API provides one)
- `requestId` — the `x-request-id` header, for support
- `body` — the parsed error body

## Retries

The client automatically retries **idempotent** requests on network errors, `5xx`, and
`429`, with exponential backoff. Idempotent = `GET`, `DELETE`, or any request you tag with
an `idempotencyKey` (including `payments.create`). Tune it:

```ts
const thru = new Thru({ apiKey, maxRetries: 4, timeoutMs: 20_000 });
```

Non-idempotent writes are never retried automatically, so you never double-charge.

## Cancellation

Pass an `AbortSignal` through the low-level client to cancel in flight:

```ts
const controller = new AbortController();
const p = thru.http.get('/payments', { signal: controller.signal });
controller.abort();
```
