/**
 * Security middleware stack.
 * Implements rate limiting, CORS, security headers, and input sanitization.
 */

import type { Context, Next } from "hono";
import { RateLimitError } from "@teleton/core/errors/domain-errors.js";
import { RateLimiter } from "@teleton/security/rate-limiter.js";

export interface SecurityConfig {
  rateLimitWindow: number; // ms
  rateLimitMax: number; // requests per window
  corsOrigins: string[];
}

export interface AuthRateLimitConfig {
  /** Max login/refresh attempts per IP per window. Default: 5 per 15 min */
  loginWindowMs?: number;
  loginMaxRequests?: number;
  /** Max refresh token requests per IP per window. Default: 20 per 15 min */
  refreshWindowMs?: number;
  refreshMaxRequests?: number;
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
 * Stricter rate limiter for authentication endpoints.
 * Applies per-IP limits on /api/auth/login and /api/auth/refresh to prevent
 * brute-force attacks and credential stuffing. Uses separate keys prefixed with
 * "auth:" so auth limits are tracked independently from general API limits.
 *
 * For production, replace the in-memory RateLimiter with a Redis-backed store.
 */
export function createAuthRateLimitMiddleware(config: AuthRateLimitConfig = {}) {
  const loginWindowMs = config.loginWindowMs ?? 15 * 60 * 1000; // 15 min
  const loginMaxRequests = config.loginMaxRequests ?? 5;
  const refreshWindowMs = config.refreshWindowMs ?? 15 * 60 * 1000; // 15 min
  const refreshMaxRequests = config.refreshMaxRequests ?? 20;

  const loginLimiter = new RateLimiter({
    windows: [{ windowMs: loginWindowMs, maxRequests: loginMaxRequests }],
  });
  const refreshLimiter = new RateLimiter({
    windows: [{ windowMs: refreshWindowMs, maxRequests: refreshMaxRequests }],
  });

  return async (ctx: Context, next: Next) => {
    const ip = ctx.req.header("x-forwarded-for") ?? "unknown";
    const path = ctx.req.path;

    let status;
    if (path === "/api/auth/login") {
      status = loginLimiter.consume(`auth:login:${ip}`);
    } else if (path === "/api/auth/refresh") {
      status = refreshLimiter.consume(`auth:refresh:${ip}`);
    } else {
      return next();
    }

    if (!status.allowed) {
      ctx.header("Retry-After", String(status.retryAfterSeconds));
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
    exposeHeaders: ["X-Request-Id", "Retry-After"],
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
