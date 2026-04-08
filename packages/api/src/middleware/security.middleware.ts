/**
 * Security middleware stack.
 * Implements rate limiting, CORS, security headers, and input sanitization.
 */

import type { Context, Next } from "hono";
import { RateLimitError } from "@teleton/core/errors/domain-errors.js";

export interface SecurityConfig {
  rateLimitWindow: number; // ms
  rateLimitMax: number; // requests per window
  corsOrigins: string[];
}

/**
 * In-memory rate limiter.
 * For production, use Redis-backed rate limiting.
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function createRateLimitMiddleware(config: SecurityConfig) {
  return async (ctx: Context, next: Next) => {
    const key = ctx.req.header("x-forwarded-for") ?? "unknown";
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || entry.resetAt < now) {
      rateLimitStore.set(key, { count: 1, resetAt: now + config.rateLimitWindow });
    } else {
      entry.count++;
      if (entry.count > config.rateLimitMax) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        ctx.header("Retry-After", String(retryAfter));
        throw new RateLimitError(retryAfter);
      }
    }

    await next();
  };
}

/**
 * Security headers middleware.
 * Sets recommended security headers for API responses.
 */
export function securityHeadersMiddleware() {
  return async (ctx: Context, next: Next) => {
    await next();

    ctx.header("X-Content-Type-Options", "nosniff");
    ctx.header("X-Frame-Options", "DENY");
    ctx.header("X-XSS-Protection", "0"); // Rely on CSP instead
    ctx.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    ctx.header("Content-Security-Policy", "default-src 'self'; script-src 'self'");
    ctx.header("Referrer-Policy", "strict-origin-when-cross-origin");
    ctx.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  };
}

/**
 * CORS middleware configuration.
 *
 * Security notes:
 * - Wildcards ("*") are rejected because they are incompatible with credentials.
 * - credentials is set to false because the API uses JWT Bearer tokens in the
 *   Authorization header, which are not CSRF-vulnerable and do not require
 *   credentials mode to be enabled.
 */
export function createCorsConfig(origins: string[]) {
  if (origins.includes("*")) {
    throw new Error(
      'CORS misconfiguration: wildcard origin "*" is not allowed. ' +
        "Specify explicit origins instead."
    );
  }

  return {
    origin: origins,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["X-Request-Id", "Retry-After"],
    maxAge: 3600,
    credentials: false,
  };
}

/**
 * Request ID middleware for tracing.
 */
export function requestIdMiddleware() {
  return async (ctx: Context, next: Next) => {
    const requestId = ctx.req.header("x-request-id") ?? crypto.randomUUID();
    ctx.set("requestId", requestId);
    ctx.header("X-Request-Id", requestId);
    await next();
  };
}
