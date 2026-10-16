// Shared test setup: a real app on the test database with in-memory SMS and storage.

import { afterAll, beforeAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { MemorySmsSender } from "../src/adapters/sms.js";
import { MemoryStorage } from "../src/adapters/storage.js";
import { FakeMaps } from "../src/adapters/maps.js";
import { loadCityConfig } from "../src/modules/pricing/city.js";
import type { AppDeps } from "../src/deps.js";
import { createPool, withTransaction, type Db } from "../src/db/pool.js";
import { createUser } from "../src/modules/users/users.js";
import { TEST_DATABASE_URL } from "./db-url.js";

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  sms: MemorySmsSender;
  storage: MemoryStorage;
  maps: FakeMaps;
}

/** The real Lagos settings, so tests follow config/cities/lagos.json. */
export const LAGOS = loadCityConfig(new URL("../config/cities/lagos.json", import.meta.url).pathname);

/**
 * Builds the app once per test file and empties the tables before each test.
 * Read the fields inside tests or hooks, not at the top of a describe block.
 */
export function useTestApp(overrides: Partial<AppDeps> = {}): TestContext {
  const ctx = {} as TestContext;

  beforeAll(async () => {
    ctx.db = createPool(TEST_DATABASE_URL);
    ctx.sms = new MemorySmsSender();
    ctx.storage = new MemoryStorage();
    ctx.maps = new FakeMaps();
    ctx.app = buildApp({
      db: ctx.db,
      sms: ctx.sms,
      storage: ctx.storage,
      maps: ctx.maps,
      city: LAGOS,
      jwtSecret: "test-jwt-secret",
      otpSecret: "test-otp-secret",
      authRateLimitPerHour: 10_000,
      ...overrides,
    });
    await ctx.app.ready();
  });

  beforeEach(async () => {
    await ctx.db.query(
      `TRUNCATE order_events, orders, quotes, otp_codes, refresh_tokens, rider_documents, rider_profiles, users, accounts
       RESTART IDENTITY CASCADE`,
    );
    ctx.sms.sent.length = 0;
    ctx.storage.files.clear();
    ctx.maps.distanceM = 10_000;
  });

  afterAll(async () => {
    await ctx.app?.close();
    await ctx.db?.end();
  });

  return ctx;
}

export interface LoggedIn {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; phone: string; role: string };
  auth: { authorization: string };
}

/** Signs in through the real OTP flow. New users get the given name. */
export async function login(ctx: TestContext, phone: string, name = "Test User"): Promise<LoggedIn> {
  const otp = await ctx.app.inject({ method: "POST", url: "/auth/otp", payload: { phone } });
  if (otp.statusCode !== 200) throw new Error(`OTP request failed: ${otp.body}`);
  const res = await ctx.app.inject({
    method: "POST",
    url: "/auth/verify",
    payload: { phone, code: ctx.sms.lastCodeFor(phone), name },
  });
  if (res.statusCode !== 200) throw new Error(`Verify failed: ${res.body}`);
  const body = res.json();
  return { ...body, auth: { authorization: `Bearer ${body.accessToken}` } };
}

/** Creates an admin directly in the database (as make-admin does) and signs them in. */
export async function loginAsAdmin(ctx: TestContext, phone = "+2348099990000"): Promise<LoggedIn> {
  await withTransaction(ctx.db, (client) => createUser(client, { phone, name: "Admin", role: "admin" }));
  return login(ctx, phone);
}

/** A multipart/form-data body with one file field. */
export function multipartFile(
  data: Buffer,
  { filename = "upload.bin", contentType = "application/octet-stream", field = "file" } = {},
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----dispatchtestboundary";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

export const FILES = {
  jpeg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF fake image")]),
  png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake png")]),
  pdf: Buffer.from("%PDF-1.4\n% fake pdf\n"),
  text: Buffer.from("just some text pretending to be a photo"),
};
