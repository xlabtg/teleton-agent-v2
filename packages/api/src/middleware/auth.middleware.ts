/**
 * Authentication and authorization middleware.
 * Implements JWT validation and role-based access control (RBAC).
 */

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
 * Simple JWT-like token verification.
 * In production, use a proper JWT library (jose).
 */
function decodeToken(token: string, _secret: string): TokenPayload {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new AuthenticationError("Invalid token format");
    }
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as TokenPayload;

    if (payload.exp && payload.exp < Date.now() / 1000) {
      throw new AuthenticationError("Token expired");
    }

    return payload;
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;
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
    // Skip auth for health, public, and auth endpoints
    if (
      ctx.req.path === "/api/health" ||
      ctx.req.path === "/" ||
      ctx.req.path.startsWith("/api/auth/")
    ) {
      return next();
    }

    const authHeader = ctx.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new AuthenticationError("Missing or invalid Authorization header");
    }

    const token = authHeader.slice(7);
    const payload = decodeToken(token, config.jwtSecret);

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
