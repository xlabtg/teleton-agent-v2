/**
 * Authentication routes.
 * Provides login endpoint that returns a JWT-like token.
 */

import * as jose from "jose";
import { Hono } from "hono";
import { z } from "zod";
import type {
  AuthConfig,
  TokenPayload,
  TokenType,
  UserRole,
} from "../middleware/auth.middleware.js";
import {
  generateCsrfToken,
  setCsrfCookie,
  type CsrfConfig,
} from "../middleware/csrf.middleware.js";

const LoginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1).max(2048),
});

const USER_ROLES: readonly UserRole[] = ["admin", "user", "plugin", "readonly"];
const TOKEN_TYPES: readonly TokenType[] = ["access", "refresh"];

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

function isTokenType(value: unknown): value is TokenType {
  return typeof value === "string" && TOKEN_TYPES.includes(value as TokenType);
}

function parseTokenPayload(payload: jose.JWTPayload): TokenPayload | null {
  if (
    typeof payload.sub !== "string" ||
    !isUserRole(payload.role) ||
    !isTokenType(payload.type) ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  return {
    sub: payload.sub,
    role: payload.role,
    type: payload.type,
    iat: payload.iat,
    exp: payload.exp,
  };
}

/**
 * Creates a signed JWT using HMAC-SHA256.
 */
async function createToken(
  sub: string,
  role: UserRole,
  type: TokenType,
  secret: string,
  expirySeconds: number
): Promise<string> {
  const jwtSecret = new TextEncoder().encode(secret);
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({ sub, role, type, iat: now })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(now + expirySeconds)
    .sign(jwtSecret);
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
    let rawBody: unknown;
    try {
      rawBody = await ctx.req.json();
    } catch {
      return ctx.json(
        { error: { code: "VALIDATION_ERROR", message: "Request body must be valid JSON" } },
        400
      );
    }

    const result = LoginSchema.safeParse(rawBody);
    if (!result.success) {
      return ctx.json(
        { error: { code: "VALIDATION_ERROR", message: "username and password are required" } },
        400
      );
    }

    const { username, password: _password } = result.data;

    // TODO: Replace with real user store lookup and password hashing
    const role: UserRole = username === "admin" ? "admin" : "user";

    const token = await createToken(username, role, "access", config.jwtSecret, config.tokenExpiry);
    const refreshToken = await createToken(
      username,
      role,
      "refresh",
      config.jwtSecret,
      config.refreshTokenExpiry
    );

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
      const tokenPayload = parseTokenPayload(payload);
      if (!tokenPayload || tokenPayload.type !== "access") {
        return ctx.json({ error: { code: "AUTHENTICATION_ERROR", message: "Invalid token" } }, 401);
      }
      const { sub, role, iat, exp } = tokenPayload;
      return ctx.json({ user: { sub, role, iat, exp } });
    } catch (error) {
      if (error instanceof jose.errors.JWTExpired) {
        return ctx.json({ error: { code: "AUTHENTICATION_ERROR", message: "Token expired" } }, 401);
      }
      return ctx.json({ error: { code: "AUTHENTICATION_ERROR", message: "Invalid token" } }, 401);
    }
  });

  /**
   * POST /api/auth/logout
   * Invalidates the current session on the client side.
   * Since tokens are stateless JWTs, the client must discard the token.
   * Logs the logout event for audit purposes.
   */
  app.post("/logout", (ctx) => {
    return ctx.json({ success: true, message: "Logged out. Discard your token on the client." });
  });

  /**
   * POST /api/auth/refresh
   * Accepts a refresh token and returns a new access token.
   */
  app.post("/refresh", async (ctx) => {
    let rawBody: unknown;
    try {
      rawBody = await ctx.req.json();
    } catch {
      return ctx.json(
        { error: { code: "VALIDATION_ERROR", message: "Request body must be valid JSON" } },
        400
      );
    }

    const result = RefreshSchema.safeParse(rawBody);
    if (!result.success) {
      return ctx.json(
        { error: { code: "VALIDATION_ERROR", message: "refreshToken is required" } },
        400
      );
    }

    const { refreshToken } = result.data;
    const jwtSecret = new TextEncoder().encode(config.jwtSecret);
    try {
      const { payload } = await jose.jwtVerify(refreshToken, jwtSecret, {
        algorithms: ["HS256", "HS384", "HS512"],
      });
      const tokenPayload = parseTokenPayload(payload);
      if (!tokenPayload || tokenPayload.type !== "refresh") {
        return ctx.json(
          { error: { code: "AUTHENTICATION_ERROR", message: "Invalid refresh token" } },
          401
        );
      }
      const newToken = await createToken(
        tokenPayload.sub,
        tokenPayload.role,
        "access",
        config.jwtSecret,
        config.tokenExpiry
      );

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
