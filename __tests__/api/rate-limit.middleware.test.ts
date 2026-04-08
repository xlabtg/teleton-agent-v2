/**
 * Rate-limit middleware tests.
 * Verifies that createRateLimitMiddleware correctly enforces limits,
 * sets X-RateLimit-* headers, and returns 429 when the limit is exceeded.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  createRateLimitMiddleware,
  createRateLimiter,
  type SecurityConfig,
} from "../../packages/api/src/middleware/security.middleware.js";
import { errorHandler } from "../../packages/api/src/middleware/error-handler.js";

const TEST_CONFIG: SecurityConfig = {
  rateLimitWindow: 60_000, // 1 minute
  rateLimitMax: 3,
  corsOrigins: [],
};

function buildApp(config: SecurityConfig) {
  const limiter = createRateLimiter(config);
  const app = new Hono();
  app.onError(errorHandler);
  app.use("*", createRateLimitMiddleware(config, limiter));
  app.get("/ping", (ctx) => ctx.json({ ok: true }));
  return app;
}

describe("createRateLimitMiddleware", () => {
  let app: Hono;

  beforeEach(() => {
    // Fresh limiter per test — avoids cross-test state
    app = buildApp(TEST_CONFIG);
  });

  it("allows requests within the limit", async () => {
    for (let i = 0; i < TEST_CONFIG.rateLimitMax; i++) {
      const res = await app.request("/ping", { headers: { "x-real-ip": "1.2.3.4" } });
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 when limit is exceeded", async () => {
    for (let i = 0; i < TEST_CONFIG.rateLimitMax; i++) {
      await app.request("/ping", { headers: { "x-real-ip": "5.5.5.5" } });
    }
    const res = await app.request("/ping", { headers: { "x-real-ip": "5.5.5.5" } });
    expect(res.status).toBe(429);
  });

  it("sets X-RateLimit-Limit header on every response", async () => {
    const res = await app.request("/ping", { headers: { "x-real-ip": "10.0.0.1" } });
    expect(res.headers.get("X-RateLimit-Limit")).toBe(String(TEST_CONFIG.rateLimitMax));
  });

  it("decrements X-RateLimit-Remaining with each request", async () => {
    const res1 = await app.request("/ping", { headers: { "x-real-ip": "10.0.0.2" } });
    const res2 = await app.request("/ping", { headers: { "x-real-ip": "10.0.0.2" } });
    const remaining1 = Number(res1.headers.get("X-RateLimit-Remaining"));
    const remaining2 = Number(res2.headers.get("X-RateLimit-Remaining"));
    expect(remaining2).toBeLessThan(remaining1);
  });

  it("includes Retry-After header on 429 response", async () => {
    for (let i = 0; i < TEST_CONFIG.rateLimitMax; i++) {
      await app.request("/ping", { headers: { "x-real-ip": "6.6.6.6" } });
    }
    const res = await app.request("/ping", { headers: { "x-real-ip": "6.6.6.6" } });
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get("Retry-After");
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it("tracks limits independently per IP", async () => {
    // Exhaust limit for IP A
    for (let i = 0; i < TEST_CONFIG.rateLimitMax; i++) {
      await app.request("/ping", { headers: { "x-real-ip": "7.0.0.1" } });
    }
    // IP B should still be allowed
    const res = await app.request("/ping", { headers: { "x-real-ip": "7.0.0.2" } });
    expect(res.status).toBe(200);
  });

  it("uses x-forwarded-for when TRUSTED_PROXIES is set", async () => {
    const original = process.env["TRUSTED_PROXIES"];
    process.env["TRUSTED_PROXIES"] = "127.0.0.1";
    try {
      const localApp = buildApp(TEST_CONFIG);
      for (let i = 0; i < TEST_CONFIG.rateLimitMax; i++) {
        await localApp.request("/ping", { headers: { "x-forwarded-for": "8.8.8.8" } });
      }
      const res = await localApp.request("/ping", {
        headers: { "x-forwarded-for": "8.8.8.8" },
      });
      expect(res.status).toBe(429);
    } finally {
      if (original === undefined) {
        delete process.env["TRUSTED_PROXIES"];
      } else {
        process.env["TRUSTED_PROXIES"] = original;
      }
    }
  });
});
