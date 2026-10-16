import { describe, expect, it } from "vitest";
import { login, loginAsAdmin, useTestApp, type LoggedIn } from "../../../test/helpers.js";

const LEKKI = { lat: 6.4474, lng: 3.4723, address: "12 Admiralty Way, Lekki Phase 1" };
const VI = { lat: 6.4281, lng: 3.4219, address: "5 Adeola Odeku St, Victoria Island" };

describe("quotes and orders", () => {
  const ctx = useTestApp();

  const quote = (session: LoggedIn, payload: Record<string, unknown> = {}) =>
    ctx.app.inject({
      method: "POST",
      url: "/quotes",
      headers: session.auth,
      payload: { pickup: LEKKI, dropoff: VI, size: "small", ...payload },
    });

  const createOrder = (session: LoggedIn, key: string, payload: Record<string, unknown>) =>
    ctx.app.inject({
      method: "POST",
      url: "/orders",
      headers: { ...session.auth, "idempotency-key": key },
      payload: { packageType: "food", recipient: { name: "Ada", phone: "0803 111 2222" }, ...payload },
    });

  async function orderFor(customer: LoggedIn, key = "order-key-0001") {
    const q = (await quote(customer)).json();
    const res = await createOrder(customer, key, { quoteId: q.quoteId, notes: "Call at the gate" });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  const cancel = (session: LoggedIn, id: string, version: number, reason?: string) =>
    ctx.app.inject({
      method: "POST",
      url: `/orders/${id}/cancel`,
      headers: session.auth,
      payload: { version, reason },
    });

  /** An approved rider assigned to the order, as Step 3's accept will do. */
  async function assignRider(orderId: string, status: string): Promise<LoggedIn> {
    const rider = await login(ctx, "+2348055556666", "Musa Rider");
    await ctx.app.inject({
      method: "POST",
      url: "/riders/apply",
      headers: rider.auth,
      payload: { vehicleType: "bike", plate: "LND 1 AB" },
    });
    await ctx.db.query("UPDATE rider_profiles SET status = 'approved' WHERE user_id = $1", [rider.user.id]);
    await ctx.db.query("UPDATE orders SET rider_id = $2, status = $3 WHERE id = $1", [orderId, rider.user.id, status]);
    return rider;
  }

  describe("POST /quotes", () => {
    it("prices a trip using road distance and names the areas", async () => {
      const customer = await login(ctx, "+2348012345678");
      const res = await quote(customer);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({
        priceKobo: 400_000, // (₦1,000 + 10 km × ₦250) + ₦500 ASAP
        distanceKm: 10,
        pickupArea: "Lekki Phase 1",
        dropoffArea: "Victoria Island",
      });
      const expiresIn = new Date(body.expiresAt).getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(9 * 60_000);
      expect(expiresIn).toBeLessThanOrEqual(10 * 60_000);
    });

    it("prices scheduled pickups without the ASAP fee", async () => {
      const customer = await login(ctx, "+2348012345678");
      const scheduledAt = new Date(Date.now() + 2 * 3600_000).toISOString();
      const res = await quote(customer, { asap: false, scheduledAt });
      expect(res.statusCode).toBe(200);
      expect(res.json().priceKobo).toBe(350_000);
    });

    it("checks scheduled times", async () => {
      const customer = await login(ctx, "+2348012345678");
      const soon = new Date(Date.now() + 5 * 60_000).toISOString();
      for (const payload of [{ asap: false }, { asap: false, scheduledAt: soon }, { asap: true, scheduledAt: soon }]) {
        const res = await quote(customer, payload);
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe("invalid_schedule");
      }
    });

    it("only quotes inside the service area", async () => {
      const customer = await login(ctx, "+2348012345678");
      const res = await quote(customer, { dropoff: { lat: 9.0765, lng: 7.3986, address: "Wuse 2, Abuja" } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("outside_service_area");
    });

    it("rejects a trip to the same place", async () => {
      const customer = await login(ctx, "+2348012345678");
      const res = await quote(customer, { dropoff: LEKKI });
      expect(res.json().error.code).toBe("same_location");
    });

    it("is for customers only", async () => {
      const anon = await ctx.app.inject({ method: "POST", url: "/quotes", payload: {} });
      expect(anon.statusCode).toBe(401);
      const admin = await loginAsAdmin(ctx);
      expect((await quote(admin)).statusCode).toBe(403);
    });
  });

  describe("POST /orders", () => {
    it("creates an order from a quote", async () => {
      const customer = await login(ctx, "+2348012345678");
      const order = await orderFor(customer);
      expect(order).toMatchObject({
        status: "created",
        statusLabel: "Awaiting payment",
        version: 0,
        pickup: { address: LEKKI.address, area: "Lekki Phase 1", lat: LEKKI.lat, lng: LEKKI.lng },
        dropoff: { address: VI.address, area: "Victoria Island" },
        recipient: { name: "Ada", phone: "+2348031112222" },
        size: "small",
        packageType: "food",
        vehicle: "bike",
        notes: "Call at the gate",
        asap: true,
        distanceM: 10_000,
        priceKobo: 400_000,
        timeline: [{ status: "created" }],
      });
      expect(order).not.toHaveProperty("riderPayoutKobo");

      const { rows } = await ctx.db.query("SELECT from_status, to_status, actor_id FROM order_events");
      expect(rows).toEqual([{ from_status: null, to_status: "created", actor_id: customer.user.id }]);
    });

    it("requires an Idempotency-Key", async () => {
      const customer = await login(ctx, "+2348012345678");
      const q = (await quote(customer)).json();
      const res = await ctx.app.inject({
        method: "POST",
        url: "/orders",
        headers: customer.auth,
        payload: { quoteId: q.quoteId, packageType: "food", recipient: { name: "Ada", phone: "08031112222" } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("idempotency_key_required");
    });

    it("returns the same order when a request is repeated", async () => {
      const customer = await login(ctx, "+2348012345678");
      const q = (await quote(customer)).json();
      const first = await createOrder(customer, "repeat-key-1", { quoteId: q.quoteId });
      const second = await createOrder(customer, "repeat-key-1", { quoteId: q.quoteId });

      expect(second.statusCode).toBe(201);
      expect(second.headers["idempotent-replayed"]).toBe("true");
      expect(second.json().id).toBe(first.json().id);
      const { rows } = await ctx.db.query("SELECT count(*)::int AS n FROM orders");
      expect(rows[0].n).toBe(1);
    });

    it("creates one order when the same request arrives twice at once", async () => {
      const customer = await login(ctx, "+2348012345678");
      const q = (await quote(customer)).json();
      const [a, b] = await Promise.all([
        createOrder(customer, "parallel-key", { quoteId: q.quoteId }),
        createOrder(customer, "parallel-key", { quoteId: q.quoteId }),
      ]);
      expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
      expect(a.json().id).toBe(b.json().id);
    });

    it("refuses a key reused for a different order", async () => {
      const customer = await login(ctx, "+2348012345678");
      const q = (await quote(customer)).json();
      await createOrder(customer, "reused-key-1", { quoteId: q.quoteId });
      const res = await createOrder(customer, "reused-key-1", { quoteId: q.quoteId, packageType: "documents" });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("idempotency_key_reused");
    });

    it("scopes keys to the customer", async () => {
      const ada = await login(ctx, "+2348012345678");
      const bola = await login(ctx, "+2348098765432");
      const adaOrder = await orderFor(ada, "shared-key-1");
      const bolaOrder = await orderFor(bola, "shared-key-1");
      expect(bolaOrder.id).not.toBe(adaOrder.id);
    });

    it("uses each quote once", async () => {
      const customer = await login(ctx, "+2348012345678");
      const q = (await quote(customer)).json();
      await createOrder(customer, "first-key-01", { quoteId: q.quoteId });
      const res = await createOrder(customer, "second-key-1", { quoteId: q.quoteId });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("quote_used");
    });

    it("rejects expired quotes", async () => {
      const customer = await login(ctx, "+2348012345678");
      const q = (await quote(customer)).json();
      await ctx.db.query("UPDATE quotes SET expires_at = now() - interval '1 second'");
      const res = await createOrder(customer, "expired-key1", { quoteId: q.quoteId });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("quote_expired");
    });

    it("won't use someone else's quote", async () => {
      const ada = await login(ctx, "+2348012345678");
      const bola = await login(ctx, "+2348098765432");
      const q = (await quote(ada)).json();
      const res = await createOrder(bola, "stolen-key-1", { quoteId: q.quoteId });
      expect(res.statusCode).toBe(404);
    });

    it("checks the recipient's phone number", async () => {
      const customer = await login(ctx, "+2348012345678");
      const q = (await quote(customer)).json();
      const res = await createOrder(customer, "bad-phone-01", { quoteId: q.quoteId, recipient: { name: "Ada", phone: "123" } });
      expect(res.json().error.code).toBe("invalid_phone");
    });
  });

  describe("GET /orders/:id", () => {
    it("shows the customer their order", async () => {
      const customer = await login(ctx, "+2348012345678");
      const order = await orderFor(customer);
      const res = await ctx.app.inject({ method: "GET", url: `/orders/${order.id}`, headers: customer.auth });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(order);
    });

    it("hides it from other customers and unassigned riders", async () => {
      const customer = await login(ctx, "+2348012345678");
      const order = await orderFor(customer);
      const other = await login(ctx, "+2348098765432");
      const res = await ctx.app.inject({ method: "GET", url: `/orders/${order.id}`, headers: other.auth });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("order_not_found");

      // An approved rider who hasn't accepted this order gets nothing, not even the area.
      const rider = await login(ctx, "+2348077778888");
      await ctx.db.query("UPDATE users SET role = 'rider' WHERE id = $1", [rider.user.id]);
      const asRider = await ctx.app.inject({ method: "GET", url: `/orders/${order.id}`, headers: rider.auth });
      expect(asRider.statusCode).toBe(404);
      expect(asRider.body).not.toContain("Admiralty");
    });

    it("gives the assigned rider addresses and payout, and masks the customer's number", async () => {
      const customer = await login(ctx, "+2348012345678", "Ada Customer");
      const order = await orderFor(customer);
      const rider = await assignRider(order.id, "accepted");

      const res = await ctx.app.inject({ method: "GET", url: `/orders/${order.id}`, headers: rider.auth });
      expect(res.statusCode).toBe(200);
      const view = res.json();
      expect(view).toMatchObject({
        pickup: { address: LEKKI.address },
        dropoff: { address: VI.address },
        customer: { name: "Ada Customer", phone: "+234 801 *** 5678" },
        payoutKobo: 320_000,
      });
      expect(view).not.toHaveProperty("priceKobo");
      expect(view).not.toHaveProperty("timeline");
    });

    it("shows admins everything", async () => {
      const customer = await login(ctx, "+2348012345678");
      const order = await orderFor(customer);
      const admin = await loginAsAdmin(ctx);
      const res = await ctx.app.inject({ method: "GET", url: `/orders/${order.id}`, headers: admin.auth });
      expect(res.json()).toMatchObject({
        customer: { id: customer.user.id, phone: "+2348012345678" },
        riderPayoutKobo: 320_000,
        timeline: [{ status: "created", actorId: customer.user.id }],
      });
    });
  });

  describe("POST /orders/:id/cancel", () => {
    it("lets the customer cancel and records it", async () => {
      const customer = await login(ctx, "+2348012345678");
      const order = await orderFor(customer);
      const res = await cancel(customer, order.id, 0, "Changed my mind");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        status: "cancelled",
        version: 1,
        timeline: [{ status: "created" }, { status: "cancelled" }],
      });

      const { rows } = await ctx.db.query(
        "SELECT from_status, to_status, note FROM order_events WHERE to_status = 'cancelled'",
      );
      expect(rows).toEqual([{ from_status: "created", to_status: "cancelled", note: "Changed my mind" }]);
    });

    it("rejects a stale version", async () => {
      const customer = await login(ctx, "+2348012345678");
      const order = await orderFor(customer);
      await ctx.db.query("UPDATE orders SET version = 3");
      const res = await cancel(customer, order.id, 0);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("version_conflict");
    });

    it("can't cancel twice", async () => {
      const customer = await login(ctx, "+2348012345678");
      const order = await orderFor(customer);
      await cancel(customer, order.id, 0);
      const res = await cancel(customer, order.id, 1);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("invalid_transition");
    });

    it("can't cancel once the package is picked up", async () => {
      const customer = await login(ctx, "+2348012345678");
      const order = await orderFor(customer);
      await assignRider(order.id, "picked_up");
      const res = await cancel(customer, order.id, 0);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("invalid_transition");
      const { rows } = await ctx.db.query("SELECT status FROM orders");
      expect(rows[0].status).toBe("picked_up");
    });

    it("lets the assigned rider cancel before pickup", async () => {
      const customer = await login(ctx, "+2348012345678");
      const order = await orderFor(customer);
      const rider = await assignRider(order.id, "to_pickup");
      const res = await cancel(rider, order.id, 0, "Bike broke down");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: "cancelled" });
    });

    it("doesn't let other users cancel", async () => {
      const customer = await login(ctx, "+2348012345678");
      const order = await orderFor(customer);
      const other = await login(ctx, "+2348098765432");
      expect((await cancel(other, order.id, 0)).statusCode).toBe(404);
    });
  });
});
