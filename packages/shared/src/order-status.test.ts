import { describe, expect, it } from "vitest";
import {
  ORDER_STATUSES,
  TERMINAL_STATUSES,
  assertTransition,
  canTransition,
  isTerminal,
  nextStatuses,
  InvalidTransitionError,
} from "./order-status.js";

describe("order status machine", () => {
  it("follows the happy path", () => {
    expect(canTransition("created", "searching", "system")).toBe(true);
    expect(canTransition("searching", "accepted", "rider")).toBe(true);
    expect(canTransition("accepted", "to_pickup", "rider")).toBe(true);
    expect(canTransition("to_pickup", "picked_up", "rider")).toBe(true);
    expect(canTransition("picked_up", "en_route", "rider")).toBe(true);
    expect(canTransition("en_route", "delivered", "rider")).toBe(true);
    expect(canTransition("delivered", "completed", "system")).toBe(true);
  });

  it("only lets riders accept", () => {
    expect(canTransition("searching", "accepted", "customer")).toBe(false);
    expect(canTransition("searching", "accepted", "admin")).toBe(false);
  });

  it("blocks cancellation once the package is picked up", () => {
    for (const s of ["picked_up", "en_route", "delivered"] as const) {
      expect(canTransition(s, "cancelled", "customer")).toBe(false);
      expect(canTransition(s, "disputed", "customer")).toBe(true);
    }
  });

  it("only admins resolve disputes", () => {
    expect(canTransition("disputed", "refunded", "admin")).toBe(true);
    expect(canTransition("disputed", "refunded", "customer")).toBe(false);
    expect(canTransition("disputed", "completed", "rider")).toBe(false);
  });

  it("has no way out of terminal statuses", () => {
    expect(TERMINAL_STATUSES).toEqual(["completed", "cancelled", "expired", "refunded"]);
    for (const s of TERMINAL_STATUSES) {
      expect(nextStatuses(s)).toEqual([]);
      expect(isTerminal(s)).toBe(true);
    }
  });

  it("never allows skipping straight to delivered", () => {
    for (const s of ORDER_STATUSES) {
      if (s === "en_route") continue;
      expect(canTransition(s, "delivered", "rider")).toBe(false);
    }
  });

  it("throws a typed error on an invalid transition", () => {
    expect(() => assertTransition("created", "delivered", "rider")).toThrow(InvalidTransitionError);
  });
});
