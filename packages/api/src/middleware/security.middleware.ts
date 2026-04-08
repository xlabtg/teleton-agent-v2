/**
 * Security middleware stack.
 * Implements rate limiting, CORS, security headers, and input sanitization.
 */

import type { Context, Next } from "hono";
import { RateLimiter } from "@teleton/security/rate-limiter.js";

export interface SecurityConfig {
  rateLimitWindow: number; // ms
  rateLimitMax: number; // requests per window
  corsOrigins: string[];
}

/**
 * Extract the real client IP from the request context.
 *
 * When `TRUSTED_PROXIES` env var is set (comma-separated CIDRs or IPs), the
 * first IP from `x-forwarded-for` is used. Otherwise we prefer `x-real-ip`
 * and fall back to the raw remote address. This prevents trivial spoofing
 * when the server is not behind a trusted reverse proxy.
 */
function getClientIP(ctx: Context): string {
  const trustedProxies = process.env["TRUSTED_PROXIES"]
    ? process.env["TRUSTED_PROXIES"].split(",").map((s) => s.trim())
    : [];

  const xForwardedFor = ctx.req.header("x-forwarded-for");
  const xRealIP = ctx.req.header("x-real-ip");

  if (trustedProxies.length > 0 && xForwardedFor) {
    // Use the leftmost (client) IP from X-Forwarded-For
    return xForwardedFor.split(",")[0]!.trim();
  }

  if (xRealIP) {
    return xRealIP.trim();
  }

  // Hono does not expose remoteAddress in all runtimes; fall back to unknown
  return "unknown";
}

/**
 * Create a RateLimiter instance from a SecurityConfig.
 * Exported so it can be instantiated and injected in tests.
 */
export function createRateLimiter(config: SecurityConfig): RateLimiter {
  return new RateLimiter({
    windows: [{ windowMs: config.rateLimitWindow, maxRequests: config.rateLimitMax }],
  });
}

/**
 * Rate-limit middleware backed by the shared RateLimiter class.
 *
 * Sets the standard X-RateLimit-* response headers and throws a
 * RateLimitError (HTTP 429) when the limit is exceeded.
 */
export function createRateLimitMiddleware(config: SecurityConfig, limiter?: RateLimiter) {
  const rl = limiter ?? createRateLimiter(config);

  return async (ctx: Context, next: Next) => {
    const key = getClientIP(ctx);
    const status = rl.consume(key);

    // Always send rate-limit headers so clients can self-throttle
    ctx.header("X-RateLimit-Limit", String(config.rateLimitMax));
    ctx.header("X-RateLimit-Remaining", String(status.remaining));
    ctx.header("X-RateLimit-Reset", String(Math.ceil(status.resetAt / 1000)));

    if (!status.allowed) {
      ctx.header("Retry-After", String(status.retryAfterSeconds));
      // RateLimiter.check throws RateLimitError; we replicate it here to avoid
      // a second consume() call and to keep the RateLimitError import local.
      const { RateLimitError } = await import("@teleton/core/errors/domain-errors.js");
      throw new RateLimitError(status.retryAfterSeconds);
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
    exposeHeaders: [
      "X-Request-Id",
      "Retry-After",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
    maxAge: 3600,
    credentials: true,
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
