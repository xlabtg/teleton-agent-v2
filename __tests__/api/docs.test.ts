/**
 * API documentation routes tests.
 * Verifies /api/docs and /api/docs/openapi.json are publicly accessible.
 */
import { describe, it, expect } from "vitest";
import { createDocsRoutes } from "../../packages/api/src/routes/docs.js";
import { createAuthMiddleware } from "../../packages/api/src/middleware/auth.middleware.js";
import { createAuthRoutes } from "../../packages/api/src/routes/auth.js";
import { createHealthRoutes } from "../../packages/api/src/routes/health.js";
import { errorHandler } from "../../packages/api/src/middleware/error-handler.js";
import { Hono } from "hono";

const TEST_AUTH_CONFIG = {
  jwtSecret: "test-secret-key",
  tokenExpiry: 3600,
  refreshTokenExpiry: 604800,
};

/** Build a minimal app with auth middleware + docs route to test public accessibility */
function buildTestApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.use("/api/*", createAuthMiddleware(TEST_AUTH_CONFIG));
  app.route("/", createHealthRoutes());
  app.route("/api/auth", createAuthRoutes(TEST_AUTH_CONFIG));
  app.route("/api/docs", createDocsRoutes());
  return app;
}

describe("Docs Routes", () => {
  const router = createDocsRoutes();

  describe("GET /", () => {
    it("should return 200 with HTML content", async () => {
      const res = await router.request("/");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<!DOCTYPE html>");
      expect(text).toContain("swagger-ui");
      expect(text).toContain("/api/docs/openapi.json");
    });
  });

  describe("GET /openapi.json", () => {
    it("should return 200 with valid OpenAPI spec", async () => {
      const res = await router.request("/openapi.json");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.openapi).toBe("3.0.3");
      expect((body.info as Record<string, unknown>).title).toBe("Teleton Agent V2 API");
      expect(body.paths).toBeDefined();
    });

    it("should include all expected endpoint paths in spec", async () => {
      const res = await router.request("/openapi.json");
      const body = (await res.json()) as Record<string, unknown>;
      const paths = body.paths as Record<string, unknown>;
      expect(paths["/api/auth/login"]).toBeDefined();
      expect(paths["/api/auth/refresh"]).toBeDefined();
      expect(paths["/api/auth/me"]).toBeDefined();
      expect(paths["/api/agents"]).toBeDefined();
      expect(paths["/health"]).toBeDefined();
    });
  });

  describe("Auth middleware integration — docs are public", () => {
    const app = buildTestApp();

    it("should allow GET /api/docs without Authorization header", async () => {
      const res = await app.request("/api/docs");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<!DOCTYPE html>");
    });

    it("should allow GET /api/docs/openapi.json without Authorization header", async () => {
      const res = await app.request("/api/docs/openapi.json");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.openapi).toBe("3.0.3");
    });
  });
});
