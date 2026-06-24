/**
 * CORS configuration security tests.
 * Verifies that createCorsConfig correctly rejects wildcard origins and
 * does not enable credentials mode (which would be dangerous for JWT-based APIs).
 */
import { describe, it, expect } from "vitest";
import { createCorsConfig } from "../../packages/api/src/middleware/security.middleware.js";
import { createServer, type ServerConfig } from "../../packages/api/src/server.js";
import { apiConfigSchema } from "../../configs/config.schema.js";

const TEST_SERVER_CONFIG: ServerConfig = {
  port: 0,
  host: "127.0.0.1",
  auth: {
    jwtSecret: "test-secret-key",
    tokenExpiry: 3600,
    refreshTokenExpiry: 604800,
  },
  security: {
    rateLimitWindow: 60_000,
    rateLimitMax: 100,
    corsOrigins: ["http://localhost:5173"],
  },
};

describe("createCorsConfig", () => {
  it("should return a valid config for explicit origins", () => {
    const config = createCorsConfig(["https://example.com", "https://app.example.com"]);
    expect(config.origin).toEqual(["https://example.com", "https://app.example.com"]);
  });

  it("should set credentials to false (JWT Bearer tokens do not need credentials mode)", () => {
    const config = createCorsConfig(["https://example.com"]);
    expect(config.credentials).toBe(false);
  });

  it("should throw when wildcard '*' is included in origins", () => {
    expect(() => createCorsConfig(["*"])).toThrow(
      'CORS misconfiguration: wildcard origin "*" is not allowed'
    );
  });

  it("should throw when wildcard '*' is mixed with explicit origins", () => {
    expect(() => createCorsConfig(["https://example.com", "*"])).toThrow(
      'CORS misconfiguration: wildcard origin "*" is not allowed'
    );
  });

  it("should include required HTTP methods", () => {
    const config = createCorsConfig(["https://example.com"]);
    expect(config.allowMethods).toContain("GET");
    expect(config.allowMethods).toContain("POST");
    expect(config.allowMethods).toContain("OPTIONS");
  });

  it("should include Authorization in allowed headers", () => {
    const config = createCorsConfig(["https://example.com"]);
    expect(config.allowHeaders).toContain("Authorization");
  });

  it("should work with an empty origins array", () => {
    const config = createCorsConfig([]);
    expect(config.origin).toEqual([]);
    expect(config.credentials).toBe(false);
  });
});

describe("apiConfigSchema CORS validation", () => {
  it("should accept valid explicit origins", () => {
    const result = apiConfigSchema.safeParse({
      cors: ["http://localhost:5173", "https://example.com"],
    });
    expect(result.success).toBe(true);
  });

  it("should reject wildcard '*' origin", () => {
    const result = apiConfigSchema.safeParse({
      cors: ["*"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('wildcard origin "*" is not allowed'))).toBe(true);
    }
  });

  it("should reject wildcard '*' mixed with explicit origins", () => {
    const result = apiConfigSchema.safeParse({
      cors: ["https://example.com", "*"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('wildcard origin "*" is not allowed'))).toBe(true);
    }
  });

  it("should use default origins when cors is not specified", () => {
    const result = apiConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cors).toEqual(["http://localhost:5173"]);
    }
  });
});

describe("createServer CORS middleware", () => {
  it("should reflect an allowed Origin header", async () => {
    const app = createServer(TEST_SERVER_CONFIG);

    const res = await app.request("/", {
      headers: { Origin: "http://localhost:5173" },
    });

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(res.headers.get("Access-Control-Expose-Headers")).toContain("X-Request-Id");
  });

  it("should not emit Access-Control-Allow-Origin for a disallowed Origin header", async () => {
    const app = createServer(TEST_SERVER_CONFIG);

    const res = await app.request("/", {
      headers: { Origin: "https://attacker.example" },
    });

    expect(res.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("should handle protected route preflight requests before auth middleware", async () => {
    const app = createServer(TEST_SERVER_CONFIG);

    const res = await app.request("/api/agents", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });
});
