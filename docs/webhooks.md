# Webhooks

thru delivers events (payment confirmed, subscription renewed, ...) to your endpoints as
signed HTTP POSTs. Always verify the signature before trusting a delivery.

## Register an endpoint

```ts
const endpoint = await thru.webhookEndpoints.create({ url: 'https://api.acme.com/thru/webhook' });
console.log(endpoint.secret); // store this — you verify signatures with it
```

## Delivery format

Each delivery includes:

| Header | Value |
| --- | --- |
| `x-thru-signature` | `sha256=<hex>` — HMAC-SHA256 of the raw body, keyed by your endpoint `secret`. |
| `x-thru-event` | The event type, e.g. `payment.confirmed`. |
| `content-type` | `application/json` |

The body is exactly `{"id","type","createdAt","data"}`. Deliveries retry up to 8 times
with exponential backoff, so **dedupe on `event.id`** (deliveries are at-least-once).

## Verify a delivery

Verify over the **raw request bytes** — do not re-serialize a parsed object, or the
signature will not match.

### Express

```ts
import express from 'express';
import { constructWebhookEvent } from 'thru-sdk';

const app = express();

app.post('/thru/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = await constructWebhookEvent({
      payload: req.body.toString('utf8'),
      signature: req.header('x-thru-signature') ?? '',
      secret: process.env.THRU_WEBHOOK_SECRET,
    });

    switch (event.type) {
      case 'payment.confirmed':
        // event.data holds the payment
        break;
      case 'subscription.renewed':
        break;
    }
    res.sendStatus(200);
  } catch {
    res.sendStatus(400); // invalid signature or body
  }
});
```

### Next.js route handler

```ts
import { constructWebhookEvent } from 'thru-sdk';

export async function POST(req: Request) {
  const payload = await req.text();
  try {
    const event = await constructWebhookEvent({
      payload,
      signature: req.headers.get('x-thru-signature') ?? '',
      secret: process.env.THRU_WEBHOOK_SECRET!,
    });
    // handle event...
    return new Response(null, { status: 200 });
  } catch {
    return new Response('bad signature', { status: 400 });
  }
}
```

## Just the boolean

If you only want a boolean and will parse the body yourself:

```ts
import { verifyWebhookSignature, readSignatureHeader } from 'thru-sdk';

const ok = await verifyWebhookSignature({
  payload: rawBody,
  signature: readSignatureHeader(req.headers) ?? '',
  secret,
});
```

Verification uses timing-safe comparison and runs on Web Crypto (works in Node 18+ and
browsers, no `node:crypto` import).
