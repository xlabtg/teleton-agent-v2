/**
 * Authentication and authorization middleware.
 * Implements JWT validation and role-based access control (RBAC).
 */

import * as jose from "jose";
import type { Context, Next } from "hono";
import { AuthenticationError, ForbiddenError } from "@teleton/core/errors/domain-errors.js";

export type UserRole = "admin" | "user" | "plugin" | "readonly";
export type TokenType = "access" | "refresh";

export interface AuthConfig {
  jwtSecret: string;
  tokenExpiry: number;
  refreshTokenExpiry: number;
}

export interface TokenPayload {
  sub: string;
  role: UserRole;
  type: TokenType;
  iat: number;
  exp: number;
}

const USER_ROLES: readonly UserRole[] = ["admin", "user", "plugin", "readonly"];
const TOKEN_TYPES: readonly TokenType[] = ["access", "refresh"];

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

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileRoutePattern(pattern: string): RegExp {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return new RegExp(`^${escapeRegexLiteral(prefix)}(?:/.*)?$`);
  }

  const regexPattern = escapeRegexLiteral(pattern).replace(/\\\*/g, ".*");
  return new RegExp(`^${regexPattern}$`);
}

const ROUTE_PERMISSION_MATCHERS = Object.entries(ROUTE_PERMISSIONS).map(
  ([pattern, allowedRoles]) => ({
    regex: compileRoutePattern(pattern),
    allowedRoles,
  })
);

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

function isTokenType(value: unknown): value is TokenType {
  return typeof value === "string" && TOKEN_TYPES.includes(value as TokenType);
}

function parseTokenPayload(payload: jose.JWTPayload): TokenPayload {
  if (
    typeof payload.sub !== "string" ||
    !isUserRole(payload.role) ||
    !isTokenType(payload.type) ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    throw new AuthenticationError("Invalid token");
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
 * Verifies a JWT token's signature and returns its payload.
 * Uses jose to cryptographically verify the HMAC-SHA256 signature.
 */
async function decodeToken(token: string, secret: string): Promise<TokenPayload> {
  const jwtSecret = new TextEncoder().encode(secret);
  try {
    const { payload } = await jose.jwtVerify(token, jwtSecret, {
      algorithms: ["HS256", "HS384", "HS512"],
    });
    const tokenPayload = parseTokenPayload(payload);
    if (tokenPayload.type !== "access") {
      throw new AuthenticationError("Invalid token");
    }
    return tokenPayload;
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      throw new AuthenticationError("Token expired");
    }
    if (error instanceof AuthenticationError) {
      throw error;
    }
    throw new AuthenticationError("Invalid token");
  }
}

function hasPermission(role: UserRole, path: string): boolean {
  for (const { regex, allowedRoles } of ROUTE_PERMISSION_MATCHERS) {
    if (regex.test(path)) {
      return allowedRoles.includes(role);
    }
  }
  return false;
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
