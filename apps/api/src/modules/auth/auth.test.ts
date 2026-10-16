import { describe, expect, it } from "vitest";
import { login, useTestApp } from "../../../test/helpers.js";

const PHONE = "+2348012345678";

describe("auth", () => {
  const ctx = useTestApp();

  const requestOtp = (phone: string = PHONE) =>
    ctx.app.inject({ method: "POST", url: "/auth/otp", payload: { phone } });
  const verify = (payload: Record<string, unknown>) =>
    ctx.app.inject({ method: "POST", url: "/auth/verify", payload: { phone: PHONE, ...payload } });

  it("signs up a new user and creates their personal account", async () => {
    const otp = await requestOtp("0801 234 5678");
    expect(otp.statusCode).toBe(200);
    expect(otp.json()).toEqual({ sent: true, expiresInSec: 300 });

    const res = await verify({ code: ctx.sms.lastCodeFor(PHONE), name: "Ada Obi" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      accessTokenExpiresIn: 900,
      user: { name: "Ada Obi", phone: PHONE, role: "customer" },
      isNewUser: true,
    });
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));

    const { rows } = await ctx.db.query(
      "SELECT a.type, a.owner_user_id FROM accounts a JOIN users u ON u.account_id = a.id WHERE u.id = $1",
      [body.user.id],
    );
    expect(rows[0]).toEqual({ type: "personal", owner_user_id: body.user.id });
  });

  it("signs in an existing user without asking for a name", async () => {
    const first = await login(ctx, PHONE, "Ada Obi");
    await ctx.db.query("UPDATE otp_codes SET created_at = now() - interval '2 minutes'");

    await requestOtp();
    const res = await verify({ code: ctx.sms.lastCodeFor(PHONE) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { id: first.user.id, name: "Ada Obi" }, isNewUser: false });
  });

  it("stores only a hash of the code", async () => {
    await requestOtp();
    const code = ctx.sms.lastCodeFor(PHONE);
    const { rows } = await ctx.db.query("SELECT code_hash FROM otp_codes");
    expect(rows[0].code_hash).not.toContain(code);
    expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("asks new users for a name without using up the code", async () => {
    await requestOtp();
    const code = ctx.sms.lastCodeFor(PHONE);

    const res = await verify({ code });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("name_required");

    const retry = await verify({ code, name: "Ada" });
    expect(retry.statusCode).toBe(200);
  });

  it("rejects invalid phone numbers", async () => {
    const res = await requestOtp("12345");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_phone");
    expect(ctx.sms.sent).toHaveLength(0);
  });

  it("returns validation errors for malformed bodies", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/auth/otp", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: "validation_error", details: [{ path: "phone" }] });
  });

  it("rejects a wrong code", async () => {
    await requestOtp();
    const wrong = ctx.sms.lastCodeFor(PHONE) === "000000" ? "111111" : "000000";
    const res = await verify({ code: wrong, name: "Ada" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("otp_invalid");
  });

  it("locks the code after 5 wrong attempts, even if the right code follows", async () => {
    await requestOtp();
    const code = ctx.sms.lastCodeFor(PHONE);
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < 5; i++) {
      expect((await verify({ code: wrong, name: "Ada" })).json().error.code).toBe("otp_invalid");
    }
    const res = await verify({ code, name: "Ada" });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("otp_locked");
  });

  it("rejects an expired code", async () => {
    await requestOtp();
    await ctx.db.query("UPDATE otp_codes SET expires_at = now() - interval '1 second'");
    const res = await verify({ code: ctx.sms.lastCodeFor(PHONE), name: "Ada" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("otp_expired");
  });

  it("won't accept a code twice", async () => {
    await requestOtp();
    const code = ctx.sms.lastCodeFor(PHONE);
    expect((await verify({ code, name: "Ada" })).statusCode).toBe(200);
    const again = await verify({ code });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe("otp_invalid");
  });

  it("enforces a cooldown between codes", async () => {
    expect((await requestOtp()).statusCode).toBe(200);
    const res = await requestOtp();
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("otp_cooldown");
    expect(ctx.sms.sent).toHaveLength(1);
  });

  it("allows at most 5 codes an hour per phone", async () => {
    await ctx.db.query(
      `INSERT INTO otp_codes (phone, code_hash, expires_at, created_at)
       SELECT $1, 'x', now(), now() - make_interval(mins => n * 10) FROM generate_series(1, 5) n`,
      [PHONE],
    );
    const res = await requestOtp();
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe("otp_limit");
  });

  it("rotates refresh tokens", async () => {
    const session = await login(ctx, PHONE);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: session.refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const next = res.json();
    expect(next.refreshToken).not.toBe(session.refreshToken);
    expect(next.accessToken).toEqual(expect.any(String));

    const again = await ctx.app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: next.refreshToken },
    });
    expect(again.statusCode).toBe(200);
  });

  it("revokes the whole family when an old refresh token is reused", async () => {
    const session = await login(ctx, PHONE);
    const refresh = (refreshToken: string) =>
      ctx.app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });

    const rotated = (await refresh(session.refreshToken)).json();
    const reuse = await refresh(session.refreshToken);
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error.code).toBe("refresh_token_reused");

    // The legitimate newer token is signed out too.
    const res = await refresh(rotated.refreshToken);
    expect(res.statusCode).toBe(401);
  });

  it("rejects unknown refresh tokens", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: "nope" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("invalid_refresh_token");
  });

  it("logs out", async () => {
    const session = await login(ctx, PHONE);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/auth/logout",
      payload: { refreshToken: session.refreshToken },
    });
    expect(res.statusCode).toBe(204);

    const refresh = await ctx.app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: session.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
  });
});

describe("auth rate limit", () => {
  const ctx = useTestApp({ authRateLimitPerHour: 2 });

  it("limits OTP requests per IP", async () => {
    const phones = ["+2348011111111", "+2348022222222", "+2348033333333"];
    const codes = [];
    for (const phone of phones) {
      codes.push((await ctx.app.inject({ method: "POST", url: "/auth/otp", payload: { phone } })).statusCode);
    }
    expect(codes).toEqual([200, 200, 429]);
    const res = await ctx.app.inject({ method: "POST", url: "/auth/otp", payload: { phone: phones[0] } });
    expect(res.json().error.code).toBe("rate_limited");
  });
});
