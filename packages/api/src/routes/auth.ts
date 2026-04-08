/**
 * Authentication routes.
 * Provides login endpoint that returns a JWT-like token.
 */

import * as jose from "jose";
import { Hono } from "hono";
import type { AuthConfig } from "../middleware/auth.middleware.js";

/**
 * Creates a signed JWT using HMAC-SHA256.
 */
async function createToken(
  sub: string,
  role: string,
  secret: string,
  expirySeconds: number
): Promise<string> {
  const jwtSecret = new TextEncoder().encode(secret);
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({ sub, role, iat: now })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(now + expirySeconds)
    .sign(jwtSecret);
}

export function createAuthRoutes(config: AuthConfig): Hono {
  const app = new Hono();

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

    const token = await createToken(username, role, config.jwtSecret, config.tokenExpiry);
    const refreshToken = await createToken(username, role, config.jwtSecret, config.refreshTokenExpiry);

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
    const jwtSecret = new TextEncoder().encode(config.jwtSecret);
    try {
      const { payload } = await jose.jwtVerify(token, jwtSecret, {
        algorithms: ["HS256", "HS384", "HS512"],
      });
      const { sub, role, iat, exp } = payload as {
        sub: string;
        role: string;
        iat: number;
        exp: number;
      };
      return ctx.json({ user: { sub, role, iat, exp } });
    } catch (error) {
      if (error instanceof jose.errors.JWTExpired) {
        return ctx.json({ error: { code: "AUTHENTICATION_ERROR", message: "Token expired" } }, 401);
      }
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

    const jwtSecret = new TextEncoder().encode(config.jwtSecret);
    try {
      const { payload } = await jose.jwtVerify(refreshToken, jwtSecret, {
        algorithms: ["HS256", "HS384", "HS512"],
      });
      const { sub, role } = payload as { sub: string; role: string };
      const newToken = await createToken(sub, role, config.jwtSecret, config.tokenExpiry);

      return ctx.json({
        token: newToken,
        expiresIn: config.tokenExpiry,
        tokenType: "Bearer",
      });
    } catch (error) {
      if (error instanceof jose.errors.JWTExpired) {
        return ctx.json(
          { error: { code: "AUTHENTICATION_ERROR", message: "Refresh token expired" } },
          401
        );
      }
      return ctx.json(
        { error: { code: "AUTHENTICATION_ERROR", message: "Invalid refresh token" } },
        401
      );
    }
  });

  return app;
}
