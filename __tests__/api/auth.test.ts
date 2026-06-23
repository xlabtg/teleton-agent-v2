/**
 * Authentication routes tests.
 * Verifies login and refresh token endpoints work correctly,
 * and that auth middleware correctly protects/exposes routes.
 */
import { describe, it, expect } from "vitest";
import * as jose from "jose";
import { createAuthRoutes } from "../../packages/api/src/routes/auth.js";
import {
  createAuthMiddleware,
  type UserRole,
} from "../../packages/api/src/middleware/auth.middleware.js";
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
  app.get("/api/unmapped", (ctx) => ctx.json({ ok: true }));
  return app;
}

async function createTestToken(role: UserRole, sub = `${role}-user`): Promise<string> {
  const jwtSecret = new TextEncoder().encode(TEST_AUTH_CONFIG.jwtSecret);
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({ sub, role, iat: now })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(now + TEST_AUTH_CONFIG.tokenExpiry)
    .sign(jwtSecret);
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

  describe("GET /api/auth/me", () => {
    const router = createAuthRoutes(TEST_AUTH_CONFIG);

    it("should return user info for valid token", async () => {
      // Get a token first
      const loginRes = await router.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "test" }),
      });
      const { token } = (await loginRes.json()) as Record<string, string>;

      const res = await router.request("/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.user).toBeDefined();
      const user = body.user as Record<string, unknown>;
      expect(user.sub).toBe("admin");
      expect(user.role).toBe("admin");
      expect(typeof user.iat).toBe("number");
      expect(typeof user.exp).toBe("number");
    });

    it("should return 401 when Authorization header is missing", async () => {
      const res = await router.request("/me");
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect((body.error as Record<string, unknown>).code).toBe("AUTHENTICATION_ERROR");
    });

    it("should return 401 for invalid token", async () => {
      const res = await router.request("/me", {
        headers: { Authorization: "Bearer not.a.valid.token" },
      });
      expect(res.status).toBe(401);
    });

    it("should return user role correctly for non-admin user", async () => {
      const loginRes = await router.request("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "password" }),
      });
      const { token } = (await loginRes.json()) as Record<string, string>;

      const res = await router.request("/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      const user = body.user as Record<string, unknown>;
      expect(user.sub).toBe("alice");
      expect(user.role).toBe("user");
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

    it.each(["readonly", "plugin"] as const)(
      "should return 403 for GET /api/agents with %s token",
      async (role) => {
        const token = await createTestToken(role);

        const res = await app.request("/api/agents", {
          headers: { Authorization: `Bearer ${token}` },
        });

        expect(res.status).toBe(403);
        const body = (await res.json()) as Record<string, Record<string, unknown>>;
        expect(body.error.code).toBe("FORBIDDEN");
      }
    );

    it("should return 403 for an API route with no explicit RBAC rule", async () => {
      const token = await createTestToken("admin");

      const res = await app.request("/api/unmapped", {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, Record<string, unknown>>;
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("should allow GET /health without token", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
    });

    it("should reject a forged token signed with a different secret (CVE: signature bypass)", async () => {
      // Attacker crafts a token claiming admin role but signs it with a different secret
      const attackerSecret = new TextEncoder().encode("attacker-secret");
      const forgedToken = await new jose.SignJWT({ sub: "attacker", role: "admin" })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
        .sign(attackerSecret);

      const res = await app.request("/api/agents", {
        headers: { Authorization: `Bearer ${forgedToken}` },
      });
      expect(res.status).toBe(401);
    });

    it("should reject a token with a manually crafted payload (no valid signature)", async () => {
      // Attacker creates a token by base64-encoding a payload without a real signature
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
        "base64url"
      );
      const payload = Buffer.from(
        JSON.stringify({ sub: "attacker", role: "admin", iat: 1000000, exp: 9999999999 })
      ).toString("base64url");
      const fakeSignature = Buffer.from("fake-signature").toString("base64url");
      const forgedToken = `${header}.${payload}.${fakeSignature}`;

      const res = await app.request("/api/agents", {
        headers: { Authorization: `Bearer ${forgedToken}` },
      });
      expect(res.status).toBe(401);
    });
  });
});
