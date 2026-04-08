/**
 * Authentication and authorization middleware.
 * Implements JWT validation and role-based access control (RBAC).
 */

import * as jose from "jose";
import type { Context, Next } from "hono";
import { AuthenticationError, ForbiddenError } from "@teleton/core/errors/domain-errors.js";

export type UserRole = "admin" | "user" | "plugin" | "readonly";

export interface AuthConfig {
  jwtSecret: string;
  tokenExpiry: number;
  refreshTokenExpiry: number;
}

export interface TokenPayload {
  sub: string;
  role: UserRole;
  iat: number;
  exp: number;
}

/**
 * Route permission map: path pattern -> allowed roles
 */
const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  "/api/admin/*": ["admin"],
  "/api/agents/*": ["admin", "user"],
  "/api/tasks/*": ["admin", "user"],
  "/api/memory/*": ["admin", "user"],
  "/api/sessions/*": ["admin", "user", "readonly"],
  "/api/config/*": ["admin"],
  "/api/plugins/*": ["admin"],
  "/api/health": ["admin", "user", "plugin", "readonly"],
};

/**
 * Verifies a JWT token's signature and returns its payload.
 * Uses jose to cryptographically verify the HMAC-SHA256 signature.
 */
async function decodeToken(token: string, secret: string): Promise<TokenPayload> {
  const jwtSecret = new TextEncoder().encode(secret);
  try {
    const { payload } = await jose.jwtVerify(token, jwtSecret, {
      algorithms: ["HS256", "HS384", "HS512"],
    });
    return payload as unknown as TokenPayload;
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      throw new AuthenticationError("Token expired");
    }
    throw new AuthenticationError("Invalid token");
  }
}

function hasPermission(role: UserRole, path: string): boolean {
  for (const [pattern, allowedRoles] of Object.entries(ROUTE_PERMISSIONS)) {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    if (regex.test(path) && !allowedRoles.includes(role)) {
      return false;
    }
  }
  return true;
}

export function createAuthMiddleware(config: AuthConfig) {
  return async (ctx: Context, next: Next) => {
    // Skip auth for health, public, auth, and docs endpoints
    if (
      ctx.req.path === "/api/health" ||
      ctx.req.path === "/" ||
      ctx.req.path.startsWith("/api/auth/") ||
      ctx.req.path.startsWith("/api/docs")
    ) {
      return next();
    }

    const authHeader = ctx.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new AuthenticationError("Missing or invalid Authorization header");
    }

    const token = authHeader.slice(7);
    const payload = await decodeToken(token, config.jwtSecret);

    if (!hasPermission(payload.role, ctx.req.path)) {
      throw new ForbiddenError("Insufficient permissions for this endpoint");
    }

    // Attach user info to context
    ctx.set("user", payload);
    ctx.set("userId", payload.sub);
    ctx.set("userRole", payload.role);

    await next();
  };
}
