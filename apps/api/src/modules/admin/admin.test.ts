import { describe, expect, it } from "vitest";
import { FILES, login, loginAsAdmin, multipartFile, useTestApp, type LoggedIn } from "../../../test/helpers.js";

describe("admin rider review", () => {
  const ctx = useTestApp();

  async function applyAsRider(phone = "+2348031112222"): Promise<LoggedIn> {
    const rider = await login(ctx, phone, "Musa Bello");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/riders/apply",
      headers: rider.auth,
      payload: { vehicleType: "bike", plate: "LND 123 AB" },
    });
    expect(res.statusCode).toBe(201);
    return rider;
  }

  async function upload(rider: LoggedIn, kind: string, data: Buffer = FILES.jpeg): Promise<{ id: string }> {
    const { payload, headers } = multipartFile(data);
    const res = await ctx.app.inject({
      method: "POST",
      url: `/riders/me/documents/${kind}`,
      headers: { ...headers, ...rider.auth },
      payload,
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  const verify = (admin: LoggedIn, riderId: string, payload: Record<string, unknown>) =>
    ctx.app.inject({ method: "POST", url: `/admin/riders/${riderId}/verify`, headers: admin.auth, payload });

  it("is closed to non-admins", async () => {
    const customer = await login(ctx, "+2348012345678");
    const res = await ctx.app.inject({ method: "GET", url: "/admin/riders", headers: customer.auth });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("forbidden");

    const anon = await ctx.app.inject({ method: "GET", url: "/admin/riders" });
    expect(anon.statusCode).toBe(401);
  });

  it("lists pending applications with their document kinds", async () => {
    const admin = await loginAsAdmin(ctx);
    const rider = await applyAsRider();
    await upload(rider, "selfie");
    await upload(rider, "nin", FILES.pdf);

    const res = await ctx.app.inject({ method: "GET", url: "/admin/riders", headers: admin.auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().riders).toEqual([
      expect.objectContaining({
        id: rider.user.id,
        name: "Musa Bello",
        phone: "+2348031112222",
        status: "pending",
        vehicleType: "bike",
        plate: "LND 123 AB",
        documentKinds: ["nin", "selfie"],
      }),
    ]);

    const approved = await ctx.app.inject({ method: "GET", url: "/admin/riders?status=approved", headers: admin.auth });
    expect(approved.json().riders).toEqual([]);
  });

  it("shows one rider with their documents", async () => {
    const admin = await loginAsAdmin(ctx);
    const rider = await applyAsRider();
    await upload(rider, "licence");

    const res = await ctx.app.inject({ method: "GET", url: `/admin/riders/${rider.user.id}`, headers: admin.auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: rider.user.id,
      documents: [{ kind: "licence", contentType: "image/jpeg" }],
      missingDocuments: ["nin", "selfie"],
    });
  });

  it("validates ids", async () => {
    const admin = await loginAsAdmin(ctx);
    const bad = await ctx.app.inject({ method: "GET", url: "/admin/riders/not-a-uuid", headers: admin.auth });
    expect(bad.statusCode).toBe(400);
    const missing = await ctx.app.inject({
      method: "GET",
      url: "/admin/riders/00000000-0000-4000-8000-000000000000",
      headers: admin.auth,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("serves a document with its stored content type", async () => {
    const admin = await loginAsAdmin(ctx);
    const rider = await applyAsRider();
    const doc = await upload(rider, "nin", FILES.pdf);

    const res = await ctx.app.inject({ method: "GET", url: `/admin/documents/${doc.id}`, headers: admin.auth });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.rawPayload.equals(FILES.pdf)).toBe(true);

    // Riders can't use the admin route to fetch documents.
    const asRider = await ctx.app.inject({ method: "GET", url: `/admin/documents/${doc.id}`, headers: rider.auth });
    expect(asRider.statusCode).toBe(403);
  });

  it("won't approve until the required documents are in", async () => {
    const admin = await loginAsAdmin(ctx);
    const rider = await applyAsRider();
    await upload(rider, "selfie");

    const blocked = await verify(admin, rider.user.id, { decision: "approve" });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatchObject({ code: "documents_missing", message: "Missing documents: nin, licence" });

    await upload(rider, "nin", FILES.pdf);
    await upload(rider, "licence");
    const res = await verify(admin, rider.user.id, { decision: "approve" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "approved" });

    const me = (await ctx.app.inject({ method: "GET", url: "/riders/me", headers: rider.auth })).json();
    expect(me.status).toBe("approved");
    expect(me.approvedAt).toEqual(expect.any(String));
    expect(me.documents.every((d: { verifiedAt: string | null }) => d.verifiedAt !== null)).toBe(true);

    const { rows } = await ctx.db.query("SELECT reviewed_by FROM rider_profiles");
    expect(rows[0].reviewed_by).toBe(admin.user.id);

    const again = await verify(admin, rider.user.id, { decision: "approve" });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("rider_not_pending");
  });

  it("needs a reason to reject, and the rider can reapply afterwards", async () => {
    const admin = await loginAsAdmin(ctx);
    const rider = await applyAsRider();

    const noReason = await verify(admin, rider.user.id, { decision: "reject" });
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json().error.code).toBe("reason_required");

    const res = await verify(admin, rider.user.id, { decision: "reject", reason: "Licence photo is blurry" });
    expect(res.statusCode).toBe(200);

    const me = (await ctx.app.inject({ method: "GET", url: "/riders/me", headers: rider.auth })).json();
    expect(me).toMatchObject({ status: "rejected", rejectionReason: "Licence photo is blurry" });

    const reapply = await ctx.app.inject({
      method: "POST",
      url: "/riders/apply",
      headers: rider.auth,
      payload: { vehicleType: "car", plate: "KJA 456 CD" },
    });
    expect(reapply.statusCode).toBe(201);
    expect(reapply.json()).toMatchObject({
      status: "pending",
      vehicleType: "car",
      rejectionReason: null,
      reviewedAt: null,
    });
  });
});
