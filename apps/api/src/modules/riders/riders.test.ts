import { describe, expect, it } from "vitest";
import { FILES, login, loginAsAdmin, multipartFile, useTestApp, type LoggedIn } from "../../../test/helpers.js";

const RIDER_PHONE = "+2348031112222";

describe("riders", () => {
  const ctx = useTestApp();

  const apply = (session: LoggedIn, payload: Record<string, unknown> = { vehicleType: "bike", plate: "lnd 123 ab" }) =>
    ctx.app.inject({ method: "POST", url: "/riders/apply", headers: session.auth, payload });

  const upload = (session: LoggedIn, kind: string, data: Buffer, contentType = "image/jpeg") => {
    const { payload, headers } = multipartFile(data, { contentType });
    return ctx.app.inject({
      method: "POST",
      url: `/riders/me/documents/${kind}`,
      headers: { ...headers, ...session.auth },
      payload,
    });
  };

  it("requires a token", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/riders/apply", payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthorized");
  });

  it("rejects a bad token", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/riders/me",
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("invalid_token");
  });

  it("lets a customer apply and become a pending rider", async () => {
    const session = await login(ctx, RIDER_PHONE);
    const res = await apply(session);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: "pending", vehicleType: "bike", plate: "LND 123 AB" });

    const me = await ctx.app.inject({ method: "GET", url: "/riders/me", headers: session.auth });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      status: "pending",
      documents: [],
      missingDocuments: ["nin", "licence", "selfie"],
    });
  });

  it("won't take a second application", async () => {
    const session = await login(ctx, RIDER_PHONE);
    await apply(session);
    const res = await apply(session);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("already_applied");
  });

  it("doesn't let admins apply", async () => {
    const admin = await loginAsAdmin(ctx);
    const res = await apply(admin);
    expect(res.statusCode).toBe(403);
  });

  it("validates the vehicle type", async () => {
    const session = await login(ctx, RIDER_PHONE);
    const res = await apply(session, { vehicleType: "plane", plate: "ABC" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation_error");
  });

  it("keeps /riders/me for riders", async () => {
    const session = await login(ctx, RIDER_PHONE);
    const res = await ctx.app.inject({ method: "GET", url: "/riders/me", headers: session.auth });
    expect(res.statusCode).toBe(403);
  });

  it("stores uploads under a server-generated key", async () => {
    const session = await login(ctx, RIDER_PHONE);
    await apply(session);

    const res = await upload(session, "nin", FILES.pdf, "image/jpeg");
    expect(res.statusCode).toBe(201);
    // Type comes from the bytes, not the client's header.
    expect(res.json()).toMatchObject({ kind: "nin", contentType: "application/pdf", sizeBytes: FILES.pdf.length });

    const keys = [...ctx.storage.files.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^riders/${session.user.id}/nin-[0-9a-f-]{36}\\.pdf$`));

    const me = (await ctx.app.inject({ method: "GET", url: "/riders/me", headers: session.auth })).json();
    expect(me.documents).toHaveLength(1);
    expect(me.missingDocuments).toEqual(["licence", "selfie"]);
  });

  it("rejects files that aren't JPEG, PNG or PDF, whatever the header says", async () => {
    const session = await login(ctx, RIDER_PHONE);
    await apply(session);
    const res = await upload(session, "licence", FILES.text, "image/png");
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe("unsupported_file_type");
    expect(ctx.storage.files.size).toBe(0);
  });

  it("requires the selfie to be an image", async () => {
    const session = await login(ctx, RIDER_PHONE);
    await apply(session);
    expect((await upload(session, "selfie", FILES.pdf)).statusCode).toBe(415);
    expect((await upload(session, "selfie", FILES.png)).statusCode).toBe(201);
  });

  it("rejects files over 5 MB", async () => {
    const session = await login(ctx, RIDER_PHONE);
    await apply(session);
    const big = Buffer.concat([FILES.jpeg, Buffer.alloc(5 * 1024 * 1024)]);
    const res = await upload(session, "nin", big);
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe("file_too_large");
    expect(ctx.storage.files.size).toBe(0);
  });

  it("rejects unknown document kinds", async () => {
    const session = await login(ctx, RIDER_PHONE);
    await apply(session);
    expect((await upload(session, "passport", FILES.jpeg)).statusCode).toBe(400);
  });

  it("replaces an earlier document of the same kind", async () => {
    const session = await login(ctx, RIDER_PHONE);
    await apply(session);
    const first = (await upload(session, "licence", FILES.jpeg)).json();
    const second = (await upload(session, "licence", FILES.png)).json();

    expect(second.id).not.toBe(first.id);
    expect([...ctx.storage.files.keys()]).toEqual([expect.stringMatching(/licence-.*\.png$/)]);
    const { rows } = await ctx.db.query("SELECT id FROM rider_documents");
    expect(rows).toEqual([{ id: second.id }]);
  });

  it("locks documents once the application is reviewed", async () => {
    const session = await login(ctx, RIDER_PHONE);
    await apply(session);
    await ctx.db.query("UPDATE rider_profiles SET status = 'approved'");
    const res = await upload(session, "vehicle", FILES.jpeg);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("profile_not_editable");
  });
});
