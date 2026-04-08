/**
 * CORS configuration security tests.
 * Verifies that createCorsConfig correctly rejects wildcard origins and
 * does not enable credentials mode (which would be dangerous for JWT-based APIs).
 */
import { describe, it, expect } from "vitest";
import { createCorsConfig } from "../../packages/api/src/middleware/security.middleware.js";
import { apiConfigSchema } from "../../configs/config.schema.js";

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
