import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("api", () => {
  const app = buildApp();
  afterAll(() => app.close());

  it("responds to health checks", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("exposes the shared order statuses", async () => {
    const res = await app.inject({ method: "GET", url: "/meta/order-statuses" });
    expect(res.json().statuses).toContain("searching");
  });
});
