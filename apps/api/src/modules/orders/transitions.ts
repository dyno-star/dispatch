// The only way an order's status changes after creation. Every change is checked against the shared
// status machine, guarded by the order's version, and recorded in order_events.

import { assertTransition, type Actor, type OrderStatus } from "@dispatch/shared";
import type { DbClient } from "../../db/pool.js";
import { conflict, notFound } from "../../http/errors.js";

export interface TransitionInput {
  orderId: string;
  to: OrderStatus;
  actor: Actor;
  /** null for system actions. */
  actorId: string | null;
  /** The version the caller last saw. A different current version means someone else changed the order. */
  expectedVersion: number;
  note?: string | null;
}

/** Call inside a transaction. Throws InvalidTransitionError if the status machine forbids the change. */
export async function transitionOrder(client: DbClient, input: TransitionInput): Promise<void> {
  const { rows } = await client.query<{ status: OrderStatus; version: number }>(
    "SELECT status, version FROM orders WHERE id = $1 FOR UPDATE",
    [input.orderId],
  );
  const order = rows[0];
  if (!order) throw notFound("order_not_found", "Order not found");
  if (order.version !== input.expectedVersion) {
    throw conflict("version_conflict", "This order has changed. Refresh and try again.");
  }
  assertTransition(order.status, input.to, input.actor);

  await client.query("UPDATE orders SET status = $2, version = version + 1, updated_at = now() WHERE id = $1", [
    input.orderId,
    input.to,
  ]);
  await client.query(
    "INSERT INTO order_events (order_id, from_status, to_status, actor_id, note) VALUES ($1, $2, $3, $4, $5)",
    [input.orderId, order.status, input.to, input.actorId, input.note ?? null],
  );
}
