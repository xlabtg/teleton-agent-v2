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
  /** Maximum allowed request body size in bytes. Default: 1_048_576 (1 MB) */
  maxBodySize?: number;
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
 */
export function createCorsConfig(origins: string[]) {
  return {
    origin: origins,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["X-Request-Id", "Retry-After"],
    maxAge: 3600,
    credentials: true,
  };
}

/**
 * Request body size limit middleware.
 * Rejects requests whose Content-Length exceeds the configured maximum.
 * Guards against DoS attacks via large payloads.
 */
export function createBodySizeLimitMiddleware(config: SecurityConfig) {
  const limit = config.maxBodySize ?? 1_048_576; // default 1 MB
  return async (ctx: Context, next: Next): Promise<Response | void> => {
    const contentLength = ctx.req.header("content-length");
    if (contentLength !== undefined && parseInt(contentLength, 10) > limit) {
      return ctx.json(
        { error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds size limit" } },
        413 as never
      );
    }
    await next();
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
