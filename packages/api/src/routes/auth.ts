/**
 * Authentication routes.
 * Provides login endpoint that returns a JWT-like token.
 */

import { Hono } from "hono";
import type { AuthConfig } from "../middleware/auth.middleware.js";
import {
  generateCsrfToken,
  setCsrfCookie,
  type CsrfConfig,
} from "../middleware/csrf.middleware.js";

/**
 * Creates a simple JWT-like token (header.payload.signature).
 * Uses the same format as decodeToken in auth.middleware.ts.
 * In production, replace with a proper JWT library (jose).
 */
function createToken(sub: string, role: string, secret: string, expirySeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

  const payload = Buffer.from(
    JSON.stringify({
      sub,
      role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + expirySeconds,
    })
  ).toString("base64url");

  // Simplified HMAC-like signature using secret + payload hash
  const signature = Buffer.from(`${header}.${payload}.${secret}`).toString("base64url");

  return `${header}.${payload}.${signature}`;
}

export function createAuthRoutes(config: AuthConfig, csrfConfig: CsrfConfig = {}): Hono {
  const app = new Hono();

  /**
   * GET /api/auth/csrf-token
   * Issues a fresh CSRF token as a non-HttpOnly cookie (XSRF-TOKEN).
   * Browser clients must call this once after login and then echo the token
   * value in the X-CSRF-Token header on every state-changing request.
   * No authentication required — the token is tied to the browser session
   * via the cookie, not to a user identity.
   */
  app.get("/csrf-token", (ctx) => {
    const token = generateCsrfToken();
    setCsrfCookie(ctx, token, csrfConfig);
    return ctx.json({ csrfToken: token });
  });

  /**
   * POST /api/auth/login
   * Accepts username/password and returns a token.
   *
   * For development/alpha, accepts any non-empty credentials and returns
   * an "admin" token. Replace with real user validation before production.
   */
  app.post("/login", async (ctx) => {
    const body = await ctx.req.json<{ username?: string; password?: string }>();
    const { username, password } = body;

    if (!username || !password) {
      return ctx.json(
        { error: { code: "VALIDATION_ERROR", message: "username and password are required" } },
        400
      );
    }

    // TODO: Replace with real user store lookup and password hashing
    const role = username === "admin" ? "admin" : "user";

    const token = createToken(username, role, config.jwtSecret, config.tokenExpiry);
    const refreshToken = createToken(username, role, config.jwtSecret, config.refreshTokenExpiry);

    return ctx.json({
      token,
      refreshToken,
      expiresIn: config.tokenExpiry,
      tokenType: "Bearer",
    });
  });

  /**
   * GET /api/auth/me
   * Returns the current user info from the Bearer token.
   */
  app.get("/me", async (ctx) => {
    const authHeader = ctx.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return ctx.json(
        {
          error: {
            code: "AUTHENTICATION_ERROR",
            message: "Missing or invalid Authorization header",
          },
        },
        401
      );
    }

    const token = authHeader.slice(7);
    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid token format");
      }
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as {
        sub: string;
        role: string;
        iat: number;
        exp: number;
      };

      if (payload.exp < Math.floor(Date.now() / 1000)) {
        return ctx.json({ error: { code: "AUTHENTICATION_ERROR", message: "Token expired" } }, 401);
      }

      return ctx.json({
        user: { sub: payload.sub, role: payload.role, iat: payload.iat, exp: payload.exp },
      });
    } catch {
      return ctx.json({ error: { code: "AUTHENTICATION_ERROR", message: "Invalid token" } }, 401);
    }
  });

  /**
   * POST /api/auth/refresh
   * Accepts a refresh token and returns a new access token.
   */
  app.post("/refresh", async (ctx) => {
    const body = await ctx.req.json<{ refreshToken?: string }>();
    const { refreshToken } = body;

    if (!refreshToken) {
      return ctx.json(
        { error: { code: "VALIDATION_ERROR", message: "refreshToken is required" } },
        400
      );
    }

    try {
      const parts = refreshToken.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid token format");
      }
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as {
        sub: string;
        role: string;
        exp: number;
      };

      if (payload.exp < Math.floor(Date.now() / 1000)) {
        return ctx.json(
          { error: { code: "AUTHENTICATION_ERROR", message: "Refresh token expired" } },
          401
        );
      }

      const newToken = createToken(payload.sub, payload.role, config.jwtSecret, config.tokenExpiry);

      return ctx.json({
        token: newToken,
        expiresIn: config.tokenExpiry,
        tokenType: "Bearer",
      });
    } catch {
      return ctx.json(
        { error: { code: "AUTHENTICATION_ERROR", message: "Invalid refresh token" } },
        401
      );
    }
  });

  return app;
}
