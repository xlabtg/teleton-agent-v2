import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";

vi.mock("../../v1-src/utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../../v1-src/services/security.js", () => ({
  initSecurity: vi.fn(() => ({
    getSettings: vi.fn(() => ({ session_timeout_minutes: null })),
  })),
}));

import { createWebUIApiAuthMiddleware } from "../../v1-src/webui/middleware/api-auth.js";
import { safeCompare } from "../../v1-src/webui/middleware/auth.js";

const AUTH_TOKEN = "test-auth-token-with-enough-length";

function createTestApp() {
  const db = new Database(":memory:");
  const deps = {
    memory: { db },
  };
  const app = new Hono();

  app.use(
    "/api/*",
    createWebUIApiAuthMiddleware(deps, AUTH_TOKEN, (c) => {
      c;
    })
  );
  app.get("/api/debug/ui-version", (c) => c.json({ success: true }));
  app.get("/auth/exchange", (c) => {
    const token = c.req.query("token");
    if (!token || !safeCompare(token, AUTH_TOKEN)) {
      return c.json({ success: false, error: "Invalid token" }, 401);
    }
    return c.redirect("/");
  });

  return { app, db };
}

describe("WebUIServer auth middleware", () => {
  it("rejects API requests authenticated only via token query parameter", async () => {
    const { app, db } = createTestApp();
    try {
      const res = await app.request(
        `/api/debug/ui-version?token=${encodeURIComponent(AUTH_TOKEN)}`
      );

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({
        success: false,
        error: "Unauthorized",
      });
    } finally {
      db.close();
    }
  });

  it("accepts API requests authenticated with bearer token", async () => {
    const { app, db } = createTestApp();
    try {
      const res = await app.request("/api/debug/ui-version", {
        headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ success: true });
    } finally {
      db.close();
    }
  });

  it("keeps token query parameter scoped to auth exchange", async () => {
    const { app, db } = createTestApp();
    try {
      const res = await app.request(`/auth/exchange?token=${encodeURIComponent(AUTH_TOKEN)}`, {
        redirect: "manual",
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/");
    } finally {
      db.close();
    }
  });
});
