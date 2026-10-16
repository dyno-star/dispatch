import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { InvalidTransitionError, ORDER_STATUSES } from "@dispatch/shared";
import type { AppDeps } from "./deps.js";
import { AppError, tooManyRequests } from "./http/errors.js";
import { authRoutes } from "./modules/auth/routes.js";
import { riderRoutes, MAX_DOCUMENT_BYTES } from "./modules/riders/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { quoteRoutes } from "./modules/orders/quote-routes.js";
import { orderRoutes } from "./modules/orders/order-routes.js";

// Builds the HTTP app without starting it, so tests can call app.inject().
// Feature modules (accounts, orders, matching, tracking, pricing, payments,
// proof, support) register their routes here as each MVP step is built.
// See docs/system-design/03-architecture.md.
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.decorateRequest("user", null);
  app.register(multipart, { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 5 } });
  // Off by default; routes opt in with config.rateLimit.
  app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) =>
      tooManyRequests("rate_limited", `Too many requests. Try again in ${ctx.after}.`),
  });

  app.get("/health", async () => ({ status: "ok" }));

  // Exposes the shared status list so clients can sanity-check they are in sync.
  app.get("/meta/order-statuses", async () => ({ statuses: ORDER_STATUSES }));

  app.register(authRoutes(deps), { prefix: "/auth" });
  app.register(riderRoutes(deps), { prefix: "/riders" });
  app.register(adminRoutes(deps), { prefix: "/admin" });
  app.register(quoteRoutes(deps), { prefix: "/quotes" });
  app.register(orderRoutes(deps), { prefix: "/orders" });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: { code: "not_found", message: `Route ${req.method} ${req.url} not found` } });
  });

  // Every error leaves as { error: { code, message } } (docs/system-design/06-api.md).
  app.setErrorHandler((err: FastifyError | AppError | ZodError | InvalidTransitionError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof InvalidTransitionError) {
      return reply.code(409).send({ error: { code: "invalid_transition", message: err.message } });
    }
    if (err instanceof ZodError) {
      const details = err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
      return reply
        .code(400)
        .send({ error: { code: "validation_error", message: "The request is not valid", details } });
    }
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: err.code ?? "bad_request", message: err.message } });
    }
    req.log.error({ err }, "Unhandled error");
    return reply.code(500).send({ error: { code: "internal_error", message: "Something went wrong" } });
  });

  return app;
}
