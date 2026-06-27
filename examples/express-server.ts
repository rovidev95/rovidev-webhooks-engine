/**
 * Minimal Express server showing how to wire the engine to a real endpoint.
 *
 *   npm run example
 *   curl -X POST http://localhost:3000/webhooks/stripe \
 *     -H "x-signature: <hmac>" -H "content-type: application/json" \
 *     -d '{"id":"evt_1","type":"payment.succeeded","data":{"amount":1000}}'
 */
import express, { type Request, type Response } from "express";
import {
  WebhookEngine,
  MemoryIdempotencyStore,
  createConsoleLogger,
  verifySignature,
  NonRetryableError,
  type WebhookEvent,
} from "../src/index.js";

const SECRET = process.env.WEBHOOK_SECRET ?? "whsec_dev_secret";

const engine = new WebhookEngine({
  store: new MemoryIdempotencyStore(),
  logger: createConsoleLogger(),
  maxAttempts: 5,
  backoff: { baseMs: 250, maxMs: 10_000 },
  deadLetter: async (entry) => {
    // In production: persist to a DLQ table / queue for manual replay.
    console.error("DEAD LETTER", entry.event.id, entry.error);
  },
});

engine
  .on<{ amount: number }>("payment.succeeded", async (event) => {
    if (typeof event.payload.amount !== "number") {
      throw new NonRetryableError("amount must be a number");
    }
    console.log(`Fulfilling order for ${event.payload.amount} cents`);
  })
  .on("subscription.canceled", async (event) => {
    console.log(`Revoking access for ${event.id}`);
  });

const app = express();
// Capture the raw body so signatures verify against exact bytes.
app.use(express.json({ verify: (req, _res, buf) => ((req as any).rawBody = buf.toString("utf8")) }));

app.post("/webhooks/stripe", async (req: Request, res: Response) => {
  const signature = String(req.header("x-signature") ?? "");
  const rawBody = (req as any).rawBody as string;

  if (!verifySignature(rawBody, signature, { secret: SECRET })) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const body = req.body as { id: string; type: string; data: unknown };
  const event: WebhookEvent = {
    id: body.id,
    type: body.type,
    payload: body.data,
    receivedAt: Date.now(),
  };

  const result = await engine.process(event);
  // Always 2xx for handled/duplicate/ignored so the provider stops retrying.
  const code = result.status === "dead_lettered" ? 500 : 200;
  return res.status(code).json(result);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Webhook example listening on http://localhost:${port}`);
});
