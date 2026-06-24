/**
 * Body size limit middleware tests.
 * Verifies that requests exceeding the configured body size are rejected.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  createBodySizeLimitMiddleware,
  type SecurityConfig,
} from "../../packages/api/src/middleware/security.middleware.js";

const TEST_SECURITY_CONFIG: SecurityConfig = {
  rateLimitWindow: 60_000,
  rateLimitMax: 100,
  corsOrigins: [],
  maxBodySize: 1024, // 1 KB for tests
};

function buildApp(config = TEST_SECURITY_CONFIG) {
  const app = new Hono();
  app.use("*", createBodySizeLimitMiddleware(config));
  app.post("/echo", async (ctx) => {
    const body = await ctx.req.text();
    return ctx.json({ received: body.length });
  });
  return app;
}

function streamBody(body: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
}

async function expectPayloadTooLarge(res: Response): Promise<void> {
  expect(res.status).toBe(413);
  const body = (await res.json()) as Record<string, unknown>;
  expect((body.error as Record<string, unknown>).code).toBe("PAYLOAD_TOO_LARGE");
}

describe("Body Size Limit Middleware", () => {
  it("should allow requests within the size limit", async () => {
    const app = buildApp();
    const res = await app.request("/echo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "50",
      },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(res.status).toBe(200);
  });

  it("should reject requests exceeding the size limit via Content-Length header", async () => {
    const app = buildApp();
    const res = await app.request("/echo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "2048", // exceeds 1024 limit
      },
      body: "x".repeat(2048),
    });
    await expectPayloadTooLarge(res);
  });

  it("should reject chunked requests exceeding the actual body size limit", async () => {
    const app = buildApp();
    const res = await app.request("/echo", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Transfer-Encoding": "chunked",
      },
      body: streamBody("x".repeat(2048)),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expectPayloadTooLarge(res);
  });

  it("should reject over-limit requests with a non-numeric Content-Length header", async () => {
    const app = buildApp();
    const res = await app.request("/echo", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": "not-a-number",
      },
      body: "x".repeat(2048),
    });
    await expectPayloadTooLarge(res);
  });

  it("should reject requests when Content-Length understates the actual body size", async () => {
    const app = buildApp();
    const res = await app.request("/echo", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": "10",
      },
      body: "x".repeat(2048),
    });
    await expectPayloadTooLarge(res);
  });

  it("should use default 1 MB limit when maxBodySize is not specified", async () => {
    const configWithoutLimit: SecurityConfig = {
      rateLimitWindow: 60_000,
      rateLimitMax: 100,
      corsOrigins: [],
    };
    const app = buildApp(configWithoutLimit);

    // Content-Length within 1 MB default
    const res = await app.request("/echo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "500",
      },
      body: "x".repeat(500),
    });
    expect(res.status).toBe(200);
  });

  it("should allow requests without a Content-Length header", async () => {
    const app = buildApp();
    const res = await app.request("/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(res.status).toBe(200);
  });
});
