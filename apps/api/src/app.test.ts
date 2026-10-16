import { describe, expect, it } from "vitest";
import { useTestApp } from "../test/helpers.js";

describe("api", () => {
  const ctx = useTestApp();

  it("responds to health checks", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("exposes the shared order statuses", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/meta/order-statuses" });
    expect(res.json().statuses).toContain("searching");
  });

  it("returns JSON errors for unknown routes", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });
});
