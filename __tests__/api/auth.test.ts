/**
 * Authentication routes tests.
 * Verifies login and refresh token endpoints work correctly,
 * and that auth middleware correctly protects/exposes routes.
 */
import { describe, it, expect } from "vitest";
import { createAuthRoutes } from "../../packages/api/src/routes/auth.js";
import { createAuthMiddleware } from "../../packages/api/src/middleware/auth.middleware.js";
import { createAgentRoutes } from "../../packages/api/src/routes/agents.js";
import { createHealthRoutes } from "../../packages/api/src/routes/health.js";
import { errorHandler } from "../../packages/api/src/middleware/error-handler.js";
import { Hono } from "hono";

const TEST_AUTH_CONFIG = {
  jwtSecret: "test-secret-key",
  tokenExpiry: 3600,
  refreshTokenExpiry: 604800,
};

/** Build a minimal app with auth middleware + routes for integration testing */
function buildTestApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.use("/api/*", createAuthMiddleware(TEST_AUTH_CONFIG));
  app.route("/", createHealthRoutes());
  app.route("/api/auth", createAuthRoutes(TEST_AUTH_CONFIG));
  app.route("/api/agents", createAgentRoutes());
  return app;
}

describe("Auth Routes", () => {
  describe("POST /api/auth/login", () => {
    const router = createAuthRoutes(TEST_AUTH_CONFIG);

    it("should return token for valid credentials", async () => {
      const res = await router.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "test" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(typeof body.token).toBe("string");
      expect(typeof body.refreshToken).toBe("string");
      expect(body.expiresIn).toBe(3600);
      expect(body.tokenType).toBe("Bearer");
    });

    it("should embed admin role for admin username", async () => {
      const res = await router.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "any" }),
      });

      const body = (await res.json()) as Record<string, unknown>;
      const token = body.token as string;
      const parts = token.split(".");
      expect(parts.length).toBe(3);
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as {
        sub: string;
        role: string;
      };
      expect(payload.sub).toBe("admin");
      expect(payload.role).toBe("admin");
    });

    it("should embed user role for non-admin username", async () => {
      const res = await router.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "password123" }),
      });

      const body = (await res.json()) as Record<string, unknown>;
      const token = body.token as string;
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as {
        sub: string;
        role: string;
      };
      expect(payload.sub).toBe("alice");
      expect(payload.role).toBe("user");
    });

    it("should return 400 when username is missing", async () => {
      const res = await router.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe("VALIDATION_ERROR");
    });

    it("should return 400 when password is missing", async () => {
      const res = await router.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /api/auth/refresh", () => {
    const router = createAuthRoutes(TEST_AUTH_CONFIG);

    it("should return new access token for valid refresh token", async () => {
      // Log in first to get a refresh token
      const loginRes = await router.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "test" }),
      });
      const { refreshToken } = (await loginRes.json()) as Record<string, string>;

      const res = await router.request("/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(typeof body.token).toBe("string");
      expect(body.expiresIn).toBe(3600);
      expect(body.tokenType).toBe("Bearer");
    });

    it("should return 400 when refreshToken is missing", async () => {
      const res = await router.request("/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe("VALIDATION_ERROR");
    });

    it("should return 401 for invalid refresh token", async () => {
      const res = await router.request("/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: "not.a.valid.token" }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("Auth middleware integration", () => {
    const app = buildTestApp();

    it("should allow POST /api/auth/login without Authorization header", async () => {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "test" }),
      });
      expect(res.status).toBe(200);
    });

    it("should allow POST /api/auth/refresh without Authorization header", async () => {
      const loginRes = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "test" }),
      });
      const { refreshToken } = (await loginRes.json()) as Record<string, string>;

      const res = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      expect(res.status).toBe(200);
    });

    it("should return 401 for GET /api/agents without token", async () => {
      const res = await app.request("/api/agents");
      expect(res.status).toBe(401);
    });

    it("should return 200 for GET /api/agents with valid token", async () => {
      const loginRes = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "test" }),
      });
      const { token } = (await loginRes.json()) as Record<string, string>;

      const res = await app.request("/api/agents", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });

    it("should allow GET /health without token", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
    });
  });
});
