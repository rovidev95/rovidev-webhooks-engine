# webhooks-engine

[![CI](https://github.com/rovidev95/rovidev-webhooks-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/rovidev95/rovidev-webhooks-engine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)

Idempotent webhook processing for Node.js. Handles the parts that usually cause
bugs with providers like Stripe: duplicate deliveries, transient failures and
signature verification.

Providers guarantee *at-least-once* delivery, so a handler can be called more
than once for the same event. This library makes sure an event is only applied
once, retries transient errors with backoff, and sends anything that keeps
failing to a dead-letter sink you control.

## Install

```bash
npm install @rovidev/webhooks-engine
# only if you use the Redis store:
npm install ioredis
```

## Usage

```ts
import { WebhookEngine, verifySignature, NonRetryableError } from "@rovidev/webhooks-engine";

const engine = new WebhookEngine({
  maxAttempts: 5,
  backoff: { baseMs: 250, maxMs: 10_000 },
  deadLetter: async ({ event, error }) => {
    await db.deadLetters.insert({ id: event.id, error });
  },
});

engine.on<{ amount: number }>("payment.succeeded", async (event) => {
  if (typeof event.payload.amount !== "number") {
    throw new NonRetryableError("amount must be a number"); // won't retry
  }
  await fulfillOrder(event.payload.amount);
});
```

Inside the HTTP handler:

```ts
if (!verifySignature(rawBody, signature, { secret: process.env.WEBHOOK_SECRET! })) {
  return res.status(401).end();
}

const result = await engine.process({
  id: body.id,
  type: body.type,
  payload: body.data,
  receivedAt: Date.now(),
});

res.status(result.status === "dead_lettered" ? 500 : 200).json(result);
```

`result.status` is one of `processed`, `duplicate`, `in_progress`, `ignored`
or `dead_lettered`.

## Multiple instances

Behind a load balancer use the Redis store so the idempotency lock is shared.
It relies on `SET key value PX <ttl> NX`, which is atomic across processes.

```ts
import Redis from "ioredis";
import { WebhookEngine, RedisIdempotencyStore } from "@rovidev/webhooks-engine";

const engine = new WebhookEngine({
  store: new RedisIdempotencyStore(new Redis(process.env.REDIS_URL!)),
});
```

## Signatures

```ts
// plain HMAC-SHA256 over the raw body
verifySignature(rawBody, signature, { secret });

// Stripe-style "t=...,v1=..." with replay protection (reject older than 5 min)
verifySignature(rawBody, header, { secret, toleranceSeconds: 300 });
```

Verify against the raw request bytes, not the re-serialized JSON.

## Stores

The `IdempotencyStore` interface has four methods (`begin`, `complete`, `fail`,
`forget`). Two implementations are included — in-memory and Redis — and you can
write your own over Postgres, DynamoDB, etc.

## Local

```bash
npm install
npm test
npm run example     # small Express server on :3000
# or
docker compose up --build
```

## Custom work

Need a webhook/payment integration built or reviewed for your stack?
Get in touch at [rovidev.com](https://rovidev.com).

## License

MIT
