// Create, view and cancel orders. See docs/system-design/05-order-lifecycle.md.

import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PACKAGE_TYPES, normalizeNigerianPhone, type Actor } from "@dispatch/shared";
import type { AppDeps } from "../../deps.js";
import type { DbClient } from "../../db/pool.js";
import { withTransaction } from "../../db/pool.js";
import { AppError, badRequest, conflict, notFound } from "../../http/errors.js";
import { currentUser, makeGuard, type AuthUser } from "../../http/auth-guard.js";
import { transitionOrder } from "./transitions.js";
import {
  ORDER_COLUMNS,
  ORDER_FROM,
  adminView,
  customerView,
  riderView,
  type OrderEventRow,
  type OrderRow,
} from "./views.js";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

const createBody = z.object({
  quoteId: z.uuid(),
  packageType: z.enum(PACKAGE_TYPES),
  notes: z.string().trim().max(500).optional(),
  recipient: z.object({
    name: z.string().trim().min(1).max(100),
    phone: z.string(),
  }),
});
const idParams = z.object({ id: z.uuid() });
const cancelBody = z.object({
  version: z.int().nonnegative(),
  reason: z.string().trim().min(1).max(500).optional(),
});

type Queryable = Pick<DbClient, "query">;

async function loadOrder(db: Queryable, id: string): Promise<OrderRow | undefined> {
  const { rows } = await db.query<OrderRow>(`SELECT ${ORDER_COLUMNS} ${ORDER_FROM} WHERE o.id = $1`, [id]);
  return rows[0];
}

async function loadEvents(db: Queryable, orderId: string): Promise<OrderEventRow[]> {
  const { rows } = await db.query<OrderEventRow>(
    "SELECT to_status, actor_id, note, created_at FROM order_events WHERE order_id = $1 ORDER BY id",
    [orderId],
  );
  return rows;
}

/** How this user relates to the order, or null if they may not see it at all. */
function actorFor(user: AuthUser, order: OrderRow): Actor | null {
  if (user.role === "admin") return "admin";
  if (order.customer_id === user.id) return "customer";
  if (order.rider_id === user.id) return "rider";
  return null;
}

async function viewFor(db: Queryable, actor: Actor, order: OrderRow) {
  if (actor === "rider") return riderView(order);
  const events = await loadEvents(db, order.id);
  return actor === "admin" ? adminView(order, events) : customerView(order, events);
}

const isUniqueViolation = (err: unknown, constraint: string) =>
  (err as { code?: string }).code === "23505" && (err as { constraint?: string }).constraint === constraint;

export function orderRoutes(deps: AppDeps): FastifyPluginAsync {
  const guard = makeGuard(deps);

  return async (app) => {
    app.post("/", { preHandler: guard("customer") }, async (req, reply) => {
      const user = currentUser(req);
      const key = req.headers["idempotency-key"];
      if (typeof key !== "string" || !IDEMPOTENCY_KEY.test(key)) {
        throw badRequest(
          "idempotency_key_required",
          "Send an Idempotency-Key header of 8 to 100 letters, digits, - or _",
        );
      }
      const body = createBody.parse(req.body);
      const recipientPhone = normalizeNigerianPhone(body.recipient.phone);
      if (!recipientPhone) throw badRequest("invalid_phone", "Enter a valid Nigerian mobile number for the recipient");

      const requestHash = createHash("sha256")
        .update(
          JSON.stringify([body.quoteId, body.packageType, body.notes ?? null, body.recipient.name, recipientPhone]),
        )
        .digest("hex");

      // A repeated request returns the order the first one created.
      const findEarlier = async (db: Queryable): Promise<OrderRow | null> => {
        const { rows } = await db.query<{ id: string }>(
          "SELECT id FROM orders WHERE customer_id = $1 AND idempotency_key = $2",
          [user.id, key],
        );
        if (!rows[0]) return null;
        const order = (await loadOrder(db, rows[0].id))!;
        if (order.request_hash !== requestHash) {
          throw new AppError(422, "idempotency_key_reused", "This Idempotency-Key was already used for a different order");
        }
        return order;
      };

      let result: { order: OrderRow; replayed: boolean } | null = null;
      const earlier = await findEarlier(deps.db);
      if (earlier) result = { order: earlier, replayed: true };

      try {
        result ??= await withTransaction(deps.db, async (client) => {
          const { rows } = await client.query<{ expired: boolean }>(
            "SELECT expires_at <= now() AS expired FROM quotes WHERE id = $1 AND customer_id = $2 FOR UPDATE",
            [body.quoteId, user.id],
          );
          const quote = rows[0];
          if (!quote) throw notFound("quote_not_found", "Quote not found");
          // Checked again under the quote lock: a parallel request with the same key may have just finished.
          const raced = await findEarlier(client);
          if (raced) return { order: raced, replayed: true };
          if (quote.expired) throw conflict("quote_expired", "This price has expired. Get a new quote.");
          const used = await client.query("SELECT 1 FROM orders WHERE quote_id = $1", [body.quoteId]);
          if (used.rowCount) throw conflict("quote_used", "This quote has already been used for an order");

          const inserted = await client.query<{ id: string }>(
            `INSERT INTO orders (account_id, customer_id, quote_id, idempotency_key, request_hash,
                                 pickup_point, pickup_address, pickup_area, dropoff_point, dropoff_address, dropoff_area,
                                 recipient_name, recipient_phone, size, package_type, vehicle, notes,
                                 asap, scheduled_at, deliver_by, distance_m, price_kobo, rider_payout_kobo)
             SELECT u.account_id, q.customer_id, q.id, $3, $4,
                    q.pickup_point, q.pickup_address, q.pickup_area, q.dropoff_point, q.dropoff_address, q.dropoff_area,
                    $5, $6, q.size, $7, q.vehicle, $8,
                    q.asap, q.scheduled_at, q.deliver_by, q.distance_m, q.price_kobo, q.rider_payout_kobo
             FROM quotes q JOIN users u ON u.id = q.customer_id
             WHERE q.id = $1 AND q.customer_id = $2
             RETURNING id`,
            [
              body.quoteId,
              user.id,
              key,
              requestHash,
              body.recipient.name,
              recipientPhone,
              body.packageType,
              body.notes || null,
            ],
          );
          const orderId = inserted.rows[0]!.id;
          await client.query(
            "INSERT INTO order_events (order_id, from_status, to_status, actor_id) VALUES ($1, NULL, 'created', $2)",
            [orderId, user.id],
          );
          return { order: (await loadOrder(client, orderId))!, replayed: false };
        });
      } catch (err) {
        // Same key, different quote, at the same moment: the other request won.
        const winner = isUniqueViolation(err, "orders_customer_idempotency_key") && (await findEarlier(deps.db));
        if (!winner) throw err;
        result = { order: winner, replayed: true };
      }

      // Sent only after the transaction has committed.
      if (result.replayed) reply.header("idempotent-replayed", "true");
      return reply.code(201).send(customerView(result.order, await loadEvents(deps.db, result.order.id)));
    });

    app.get("/:id", { preHandler: guard() }, async (req) => {
      const user = currentUser(req);
      const { id } = idParams.parse(req.params);
      const order = await loadOrder(deps.db, id);
      const actor = order && actorFor(user, order);
      // Same answer for "doesn't exist" and "not yours", so ids can't be probed.
      if (!order || !actor) throw notFound("order_not_found", "Order not found");
      return viewFor(deps.db, actor, order);
    });

    app.post("/:id/cancel", { preHandler: guard() }, async (req) => {
      const user = currentUser(req);
      const { id } = idParams.parse(req.params);
      const body = cancelBody.parse(req.body);

      return withTransaction(deps.db, async (client) => {
        const order = await loadOrder(client, id);
        const actor = order && actorFor(user, order);
        if (!order || !actor) throw notFound("order_not_found", "Order not found");

        await transitionOrder(client, {
          orderId: id,
          to: "cancelled",
          actor,
          actorId: user.id,
          expectedVersion: body.version,
          note: body.reason,
        });
        req.log.info({ orderId: id, actor, userId: user.id }, "Order cancelled");
        return viewFor(client, actor, (await loadOrder(client, id))!);
      });
    });
  };
}
