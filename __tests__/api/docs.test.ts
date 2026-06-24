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
import { createServer, type ServerConfig } from "../../packages/api/src/server.js";
import { Hono } from "hono";

const TEST_AUTH_CONFIG = {
  jwtSecret: "test-secret-key",
  tokenExpiry: 3600,
  refreshTokenExpiry: 604800,
};

const TEST_SERVER_CONFIG: ServerConfig = {
  port: 0,
  host: "127.0.0.1",
  auth: TEST_AUTH_CONFIG,
  security: {
    rateLimitWindow: 60_000,
    rateLimitMax: 100,
    corsOrigins: [],
  },
};

/** Build a minimal app with auth middleware + docs route to test public accessibility */
function buildTestApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.use("/api/*", createAuthMiddleware(TEST_AUTH_CONFIG));
  app.route("/", createHealthRoutes());
  app.route("/api/auth", createAuthRoutes(TEST_AUTH_CONFIG));
  app.route("/api/docs", createDocsRoutes());
  app.get("/api/docs-internal", (ctx) => ctx.json({ ok: true }));
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
      expect(text).toContain("/api/docs/swagger-init.js");
    });
  });

  describe("GET /swagger-init.js", () => {
    it("should return a same-origin Swagger UI bootstrap script", async () => {
      const res = await router.request("/swagger-init.js");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/javascript");

      const text = await res.text();
      expect(text).toContain("SwaggerUIBundle({");
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

    it("should require Authorization for docs-prefixed sibling routes", async () => {
      const res = await app.request("/api/docs-internal");
      expect(res.status).toBe(401);
    });
  });

  describe("Security headers integration — Swagger assets are permitted", () => {
    const app = createServer(TEST_SERVER_CONFIG);

    it("should allow the docs page Swagger assets without inline script execution", async () => {
      const res = await app.request("/api/docs");

      expect(res.status).toBe(200);
      const csp = res.headers.get("Content-Security-Policy");
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self' https://unpkg.com");
      expect(csp).toContain("style-src 'self' https://unpkg.com");
      expect(csp).not.toContain("'unsafe-inline'");

      const text = await res.text();
      expect(text).toContain("https://unpkg.com/swagger-ui-dist@5/swagger-ui.css");
      expect(text).toContain("https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js");
      expect(text).toContain('src="/api/docs/swagger-init.js"');
      expect(text).not.toMatch(/<script>\s*SwaggerUIBundle/);
    });

    it("should keep the default strict CSP outside the docs route", async () => {
      const res = await app.request("/");

      expect(res.headers.get("Content-Security-Policy")).toBe(
        "default-src 'self'; script-src 'self'"
      );
    });
  });
});
