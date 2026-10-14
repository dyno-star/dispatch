import Fastify, { type FastifyInstance } from "fastify";
import { ORDER_STATUSES } from "@dispatch/shared";

// Builds the HTTP app without starting it, so tests can call app.inject().
// Feature modules (accounts, orders, matching, tracking, pricing, payments,
// proof, support) register their routes here as each MVP step is built.
// See docs/system-design/03-architecture.md.
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.get("/health", async () => ({ status: "ok" }));

  // Exposes the shared status list so clients can sanity-check they are in sync.
  app.get("/meta/order-statuses", async () => ({ statuses: ORDER_STATUSES }));

  return app;
}
