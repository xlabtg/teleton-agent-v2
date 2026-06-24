/**
 * Security middleware stack.
 * Implements rate limiting, CORS, security headers, and input sanitization.
 */

import type { Context, Next } from "hono";
import { isIP } from "node:net";
import { RateLimiter } from "@teleton/security/rate-limiter.js";

const BODY_SIZE_LIMIT_ERROR_CODE = "PAYLOAD_TOO_LARGE";

export interface SecurityConfig {
  rateLimitWindow: number; // ms
  rateLimitMax: number; // requests per window
  corsOrigins: string[];
  /** Maximum allowed request body size in bytes. Default: 1_048_576 (1 MB) */
  maxBodySize?: number;
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
 * Extract the real client IP from the request context.
 *
 * When `TRUSTED_PROXIES` env var is set (comma-separated CIDRs or IPs), the
 * first IP from `x-forwarded-for` is used only if the immediate peer is a
 * configured trusted proxy. Otherwise we prefer the raw remote address, then
 * `x-real-ip`. This prevents trivial spoofing when the server is not behind a
 * trusted reverse proxy.
 */
function getClientIP(ctx: Context): string {
  const trustedProxies = process.env["TRUSTED_PROXIES"]
    ? process.env["TRUSTED_PROXIES"]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const xForwardedFor = getForwardedClientIP(ctx.req.header("x-forwarded-for"));
  const xRealIP = normalizeIP(ctx.req.header("x-real-ip")?.trim());
  const remoteAddress = getRemoteAddress(ctx);
  const peerIP = remoteAddress ?? xRealIP;

  if (peerIP && trustedProxies.some((proxy) => isTrustedProxy(peerIP, proxy)) && xForwardedFor) {
    return xForwardedFor;
  }

  if (remoteAddress) return remoteAddress;
  if (xRealIP) return xRealIP;

  return "unknown";
}

function getRemoteAddress(ctx: Context): string | undefined {
  const env = ctx.env as
    | {
        incoming?: { socket?: { remoteAddress?: string | null } };
        ip?: string | null;
      }
    | undefined;

  return normalizeIP(env?.incoming?.socket?.remoteAddress?.trim()) ?? normalizeIP(env?.ip?.trim());
}

function getForwardedClientIP(header: string | undefined): string | undefined {
  return header
    ?.split(",")
    .map((part) => part.trim())
    .find(Boolean);
}

function normalizeIP(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

function isTrustedProxy(peerIP: string, proxy: string): boolean {
  if (proxy.includes("/")) {
    return isIPInCidr(peerIP, proxy);
  }

  return normalizeIP(proxy) === peerIP;
}

function isIPInCidr(ip: string, cidr: string): boolean {
  const [network, prefixText] = cidr.split("/");
  const prefix = Number(prefixText);
  const ipValue = ipToBigInt(ip);
  const networkValue = network ? ipToBigInt(network) : undefined;

  if (
    ipValue === undefined ||
    networkValue === undefined ||
    ipValue.version !== networkValue.version
  ) {
    return false;
  }

  const bits = ipValue.version === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) {
    return false;
  }

  const shift = BigInt(bits - prefix);
  return ipValue.value >> shift === networkValue.value >> shift;
}

function ipToBigInt(ip: string): { version: 4 | 6; value: bigint } | undefined {
  const normalized = normalizeIP(ip);
  const version = normalized ? isIP(normalized) : 0;

  if (!normalized || version === 0) return undefined;

  if (version === 4) {
    return { version: 4, value: ipv4ToBigInt(normalized) };
  }

  return { version: 6, value: ipv6ToBigInt(normalized) };
}

function ipv4ToBigInt(ip: string): bigint {
  return ip.split(".").reduce((acc, part) => (acc << 8n) + BigInt(Number(part)), 0n);
}

function ipv6ToBigInt(ip: string): bigint {
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const headParts = head === "" ? [] : head.split(":");
  const tailParts = tail === "" ? [] : tail.split(":");
  const missingParts = 8 - headParts.length - tailParts.length;
  const parts = [...headParts, ...Array<string>(missingParts).fill("0"), ...tailParts];

  return parts.reduce((acc, part) => (acc << 16n) + BigInt(parseInt(part, 16)), 0n);
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
    const ip = getClientIP(ctx);
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
    ctx.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
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
    allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    exposeHeaders: [
      "X-Request-Id",
      "Retry-After",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
    maxAge: 3600,
    credentials: false,
  };
}

/**
 * Request body size limit middleware.
 * Rejects requests whose actual body size exceeds the configured maximum.
 * Guards against DoS attacks via large payloads.
 */
export function createBodySizeLimitMiddleware(config: SecurityConfig) {
  const limit = config.maxBodySize ?? 1_048_576; // default 1 MB
  return async (ctx: Context, next: Next): Promise<Response | void> => {
    const contentLength = ctx.req.header("content-length");
    const advertisedLength = parseContentLength(contentLength);

    if (advertisedLength !== undefined && advertisedLength > limit) {
      return bodyTooLargeResponse(ctx);
    }

    const rawRequest = ctx.req.raw;
    if (rawRequest.body !== null) {
      try {
        ctx.req.raw = await cloneRequestWithLimitedBody(rawRequest, limit);
      } catch (error) {
        if (error instanceof BodySizeLimitExceededError) {
          return bodyTooLargeResponse(ctx);
        }
        throw error;
      }
    }

    await next();
  };
}

function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

async function cloneRequestWithLimitedBody(request: Request, limit: number): Promise<Request> {
  const body = await readBodyWithLimit(request, limit);
  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    body,
    redirect: request.redirect,
    signal: request.signal,
  };

  return new Request(request.url, init);
}

async function readBodyWithLimit(request: Request, limit: number): Promise<Uint8Array> {
  if (request.body === null) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > limit) {
        await reader.cancel();
        throw new BodySizeLimitExceededError();
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

function bodyTooLargeResponse(ctx: Context): Response {
  return ctx.json(
    {
      error: {
        code: BODY_SIZE_LIMIT_ERROR_CODE,
        message: "Request body exceeds size limit",
      },
    },
    413 as never
  );
}

class BodySizeLimitExceededError extends Error {
  constructor() {
    super("Request body exceeds size limit");
  }
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
