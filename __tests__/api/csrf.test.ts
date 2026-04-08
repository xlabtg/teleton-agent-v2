/**
 * CSRF protection middleware tests.
 *
 * Covers:
 * - Safe methods (GET/HEAD/OPTIONS) are always allowed without a CSRF token
 * - Auth endpoints are exempt (login, refresh, csrf-token itself)
 * - State-changing requests without CSRF cookie are allowed (non-browser clients)
 * - State-changing requests with CSRF cookie but no header are rejected (403)
 * - State-changing requests with mismatched cookie/header are rejected (403)
 * - State-changing requests with matching cookie/header are accepted (200)
 * - GET /api/auth/csrf-token issues a cookie and returns a token
 * - generateCsrfToken produces unique 64-char hex strings
 * - parseCsrfCookie helper behaviour (via middleware cookie parsing)
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  createCsrfMiddleware,
  generateCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "../../packages/api/src/middleware/csrf.middleware.js";
import { createAuthRoutes } from "../../packages/api/src/routes/auth.js";
import { createAgentRoutes } from "../../packages/api/src/routes/agents.js";
import { createAuthMiddleware } from "../../packages/api/src/middleware/auth.middleware.js";
import { errorHandler } from "../../packages/api/src/middleware/error-handler.js";

const TEST_AUTH_CONFIG = {
  jwtSecret: "test-secret-key",
  tokenExpiry: 3600,
  refreshTokenExpiry: 604800,
};

/** Build a test app with auth + CSRF middleware and typical routes. */
function buildTestApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.use("/api/*", createAuthMiddleware(TEST_AUTH_CONFIG));
  app.use("/api/*", createCsrfMiddleware());
  app.route("/api/auth", createAuthRoutes(TEST_AUTH_CONFIG));
  app.route("/api/agents", createAgentRoutes());
  return app;
}

/** Obtains a valid Bearer token by logging in. */
async function getBearerToken(app: Hono): Promise<string> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "test" }),
  });
  const { token } = (await res.json()) as Record<string, string>;
  return token;
}

// ---------------------------------------------------------------------------
// generateCsrfToken
// ---------------------------------------------------------------------------

describe("generateCsrfToken", () => {
  it("should return a 64-character hex string", () => {
    const token = generateCsrfToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should produce unique tokens on each call", () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateCsrfToken()));
    expect(tokens.size).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/csrf-token
// ---------------------------------------------------------------------------

describe("GET /api/auth/csrf-token", () => {
  const app = buildTestApp();

  it("should return 200 with a csrfToken body field", async () => {
    const res = await app.request("/api/auth/csrf-token");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
    expect(typeof body.csrfToken).toBe("string");
    expect(body.csrfToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should set XSRF-TOKEN cookie", async () => {
    const res = await app.request("/api/auth/csrf-token");
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`${CSRF_COOKIE_NAME}=`);
    expect(setCookie).toContain("SameSite=Strict");
  });

  it("cookie value should match the body csrfToken", async () => {
    const res = await app.request("/api/auth/csrf-token");
    const body = (await res.json()) as Record<string, string>;
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    // Extract cookie value: "XSRF-TOKEN=<value>; ..."
    const match = setCookie.match(new RegExp(`${CSRF_COOKIE_NAME}=([^;]+)`));
    expect(match).not.toBeNull();
    expect(match![1]).toBe(body.csrfToken);
  });
});

// ---------------------------------------------------------------------------
// Safe methods — always allowed
// ---------------------------------------------------------------------------

describe("CSRF middleware — safe HTTP methods", () => {
  const app = buildTestApp();

  it("should allow GET requests without CSRF token", async () => {
    const token = await getBearerToken(app);
    const res = await app.request("/api/agents", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("should allow HEAD requests without CSRF token", async () => {
    const token = await getBearerToken(app);
    const res = await app.request("/api/agents", {
      method: "HEAD",
      headers: { Authorization: `Bearer ${token}` },
    });
    // Hono may return 404 for HEAD on a route that only handles GET, but NOT 403
    expect(res.status).not.toBe(403);
  });

  it("should allow OPTIONS requests without CSRF token", async () => {
    const res = await app.request("/api/agents", { method: "OPTIONS" });
    expect(res.status).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Auth endpoints — always exempt
// ---------------------------------------------------------------------------

describe("CSRF middleware — auth endpoints are exempt", () => {
  const app = buildTestApp();

  it("should allow POST /api/auth/login without CSRF cookie or header", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "test" }),
    });
    expect(res.status).toBe(200);
  });

  it("should allow POST /api/auth/refresh without CSRF cookie or header", async () => {
    // Obtain a refresh token first
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
});

// ---------------------------------------------------------------------------
// Non-browser API clients (no CSRF cookie) — allowed through
// ---------------------------------------------------------------------------

describe("CSRF middleware — non-browser clients (no cookie)", () => {
  const app = buildTestApp();

  it("should allow POST without CSRF cookie (API/CLI client)", async () => {
    const token = await getBearerToken(app);
    const res = await app.request("/api/agents/agent-1/tasks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ task: "do something" }),
    });
    // No CSRF cookie present → treated as non-browser → should NOT be 403
    expect(res.status).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Browser clients with CSRF cookie present — must supply matching header
// ---------------------------------------------------------------------------

describe("CSRF middleware — browser clients (cookie present)", () => {
  const app = buildTestApp();

  it("should reject POST when cookie present but X-CSRF-Token header missing", async () => {
    const authToken = await getBearerToken(app);
    const csrfToken = generateCsrfToken();

    const res = await app.request("/api/agents/agent-1/tasks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
        Cookie: `${CSRF_COOKIE_NAME}=${csrfToken}`,
        // Deliberately omit X-CSRF-Token header
      },
      body: JSON.stringify({ task: "attack" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe("FORBIDDEN");
  });

  it("should reject POST when cookie and header values do not match", async () => {
    const authToken = await getBearerToken(app);
    const csrfToken = generateCsrfToken();
    const wrongToken = generateCsrfToken(); // different token

    const res = await app.request("/api/agents/agent-1/tasks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
        Cookie: `${CSRF_COOKIE_NAME}=${csrfToken}`,
        [CSRF_HEADER_NAME]: wrongToken,
      },
      body: JSON.stringify({ task: "attack" }),
    });
    expect(res.status).toBe(403);
  });

  it("should allow POST when cookie matches X-CSRF-Token header", async () => {
    const authToken = await getBearerToken(app);
    const csrfToken = generateCsrfToken();

    const res = await app.request("/api/agents/agent-1/tasks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
        Cookie: `${CSRF_COOKIE_NAME}=${csrfToken}`,
        [CSRF_HEADER_NAME]: csrfToken,
      },
      body: JSON.stringify({ task: "do something" }),
    });
    // Should not be rejected by CSRF middleware (202 from agents route)
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(202);
  });

  it("should work with multiple cookies in Cookie header", async () => {
    const authToken = await getBearerToken(app);
    const csrfToken = generateCsrfToken();

    const res = await app.request("/api/agents/agent-1/tasks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
        Cookie: `session=abc123; ${CSRF_COOKIE_NAME}=${csrfToken}; other=xyz`,
        [CSRF_HEADER_NAME]: csrfToken,
      },
      body: JSON.stringify({ task: "do something" }),
    });
    expect(res.status).not.toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Full flow: obtain CSRF token, then use it for mutations
// ---------------------------------------------------------------------------

describe("CSRF middleware — full browser flow", () => {
  const app = buildTestApp();

  it("should complete the full CSRF flow: get token → use in mutation", async () => {
    // Step 1: Login to get Bearer token
    const authToken = await getBearerToken(app);

    // Step 2: Fetch CSRF token (simulates browser calling endpoint once after login)
    const csrfRes = await app.request("/api/auth/csrf-token");
    expect(csrfRes.status).toBe(200);
    const { csrfToken } = (await csrfRes.json()) as Record<string, string>;

    // Step 3: Extract cookie value from Set-Cookie header
    const setCookie = csrfRes.headers.get("Set-Cookie") ?? "";
    const match = setCookie.match(new RegExp(`${CSRF_COOKIE_NAME}=([^;]+)`));
    expect(match).not.toBeNull();
    const cookieValue = match![1];

    // Step 4: Send mutation with matching cookie + header
    const mutationRes = await app.request("/api/agents/agent-1/tasks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
        Cookie: `${CSRF_COOKIE_NAME}=${cookieValue}`,
        [CSRF_HEADER_NAME]: csrfToken,
      },
      body: JSON.stringify({ task: "legitimate request" }),
    });
    expect(mutationRes.status).toBe(202);
  });
});
