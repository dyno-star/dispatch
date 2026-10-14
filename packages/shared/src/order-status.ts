// Order status machine — single source of truth for the API and apps.
// Mirrors docs/system-design/05-order-lifecycle.md.

export const ORDER_STATUSES = [
  "created",
  "searching",
  "accepted",
  "to_pickup",
  "picked_up",
  "en_route",
  "delivered",
  "completed",
  "cancelled",
  "expired",
  "disputed",
  "refunded",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Who is allowed to trigger a transition. "system" = background jobs and webhooks. */
export type Actor = "customer" | "rider" | "admin" | "system";

interface Transition {
  to: OrderStatus;
  by: readonly Actor[];
}

const TRANSITIONS: Record<OrderStatus, readonly Transition[]> = {
  created: [
    { to: "searching", by: ["system"] }, // payment authorised
    { to: "cancelled", by: ["customer", "admin"] },
  ],
  searching: [
    { to: "accepted", by: ["rider"] },
    { to: "cancelled", by: ["customer", "admin"] },
    { to: "expired", by: ["system"] }, // no rider at max radius
  ],
  accepted: [
    { to: "to_pickup", by: ["rider"] },
    { to: "cancelled", by: ["customer", "rider", "admin"] },
  ],
  to_pickup: [
    { to: "picked_up", by: ["rider"] },
    { to: "cancelled", by: ["customer", "rider", "admin"] }, // fee may apply
  ],
  picked_up: [
    { to: "en_route", by: ["rider"] },
    { to: "disputed", by: ["customer", "rider", "admin"] },
  ],
  en_route: [
    { to: "delivered", by: ["rider"] },
    { to: "disputed", by: ["customer", "rider", "admin"] },
  ],
  delivered: [
    { to: "completed", by: ["system", "admin"] },
    { to: "disputed", by: ["customer", "rider", "admin"] },
  ],
  disputed: [
    { to: "completed", by: ["admin"] },
    { to: "refunded", by: ["admin"] },
  ],
  completed: [],
  cancelled: [],
  expired: [],
  refunded: [],
};

export const TERMINAL_STATUSES: readonly OrderStatus[] = ORDER_STATUSES.filter(
  (s) => TRANSITIONS[s].length === 0,
);

/** Statuses during which live tracking and share links are active. */
export const TRACKABLE_STATUSES: readonly OrderStatus[] = [
  "accepted",
  "to_pickup",
  "picked_up",
  "en_route",
];

export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[from].map((t) => t.to);
}

export function canTransition(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  return TRANSITIONS[from].some((t) => t.to === to && t.by.includes(actor));
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: OrderStatus,
    public readonly to: OrderStatus,
    public readonly actor: Actor,
  ) {
    super(`Order cannot move from "${from}" to "${to}" by ${actor}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus, actor: Actor): void {
  if (!canTransition(from, to, actor)) {
    throw new InvalidTransitionError(from, to, actor);
  }
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Labels shown to customers and on the public tracking page. */
export const CUSTOMER_STATUS_LABELS: Record<OrderStatus, string> = {
  created: "Awaiting payment",
  searching: "Finding a rider",
  accepted: "Rider accepted",
  to_pickup: "Heading to pickup",
  picked_up: "Package picked up",
  en_route: "On the way",
  delivered: "Delivered",
  completed: "Delivered",
  cancelled: "Cancelled",
  expired: "No rider found",
  disputed: "Under review",
  refunded: "Refunded",
};
