/**
 * CSRF (Cross-Site Request Forgery) protection middleware.
 *
 * Implements the double-submit cookie pattern:
 * 1. Server issues a random CSRF token via GET /api/auth/csrf-token
 * 2. Token is stored in a non-HttpOnly cookie (XSRF-TOKEN) so JS can read it
 * 3. Browser JS must echo the token back in the X-CSRF-Token request header
 * 4. Middleware validates header == cookie for all state-changing requests
 *
 * Why this works: Attackers cannot read the victim's cookies from a different
 * origin (SameOrigin policy), so they cannot forge the matching header value.
 *
 * Safe methods (GET, HEAD, OPTIONS) are always skipped — they must not modify
 * server state per HTTP spec.
 *
 * API-only clients (curl, CI pipelines) that use Bearer tokens without cookies
 * are exempt: if no XSRF-TOKEN cookie is present the request is treated as a
 * non-browser client and is allowed through. Browser clients set credentials:
 * "include" on every fetch, so the cookie will always be present once issued.
 */

import type { Context, Next } from "hono";
import { ForbiddenError } from "@teleton/core/errors/domain-errors.js";

export const CSRF_COOKIE_NAME = "XSRF-TOKEN";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const CSRF_TOKEN_BYTE_LENGTH = 32;

/**
 * Generates a cryptographically-random CSRF token (hex string, 64 chars).
 */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(CSRF_TOKEN_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface CsrfConfig {
  /** Cookie domain (optional). Defaults to request host. */
  cookieDomain?: string;
  /** Secure flag on the cookie. Set true in production (HTTPS). Defaults to false for dev. */
  secureCookie?: boolean;
  /** SameSite value for the cookie. Defaults to "Strict". */
  sameSite?: "Strict" | "Lax" | "None";
}

/**
 * CSRF protection middleware using the double-submit cookie pattern.
 *
 * Mount AFTER auth middleware so only authenticated routes are checked.
 * Skip list mirrors the auth middleware skip list (auth and health endpoints).
 */
export function createCsrfMiddleware(config: CsrfConfig = {}) {
  const { secureCookie = false, sameSite = "Strict" } = config;

  return async (ctx: Context, next: Next) => {
    const method = ctx.req.method.toUpperCase();

    // Safe HTTP methods do not modify server state — skip CSRF check
    if (["GET", "HEAD", "OPTIONS"].includes(method)) {
      return next();
    }

    // Skip CSRF for auth endpoints (login/refresh do not rely on browser cookies)
    // and for the CSRF token endpoint itself
    const path = ctx.req.path;
    if (path.startsWith("/api/auth/") || path === "/api/health" || path === "/") {
      return next();
    }

    // Read the CSRF token from the cookie
    const cookieHeader = ctx.req.header("Cookie") ?? "";
    const cookieToken = parseCsrfCookie(cookieHeader);

    // If there is no CSRF cookie the client is a non-browser API consumer
    // (e.g. curl or CI) — allow it through. Browser clients always carry the
    // cookie once they call /api/auth/csrf-token.
    if (!cookieToken) {
      return next();
    }

    // Browser client: require matching X-CSRF-Token header
    const headerToken = ctx.req.header(CSRF_HEADER_NAME);

    if (!headerToken || !safeEqual(cookieToken, headerToken)) {
      throw new ForbiddenError("Invalid or missing CSRF token");
    }

    await next();

    // Refresh the cookie on each mutating request to extend its lifetime
    setCsrfCookie(ctx, cookieToken, { secureCookie, sameSite });
  };
}

/**
 * Sets the XSRF-TOKEN cookie on the response.
 * The cookie is intentionally NOT HttpOnly so that browser JS can read it.
 */
export function setCsrfCookie(
  ctx: Context,
  token: string,
  config: { secureCookie?: boolean; sameSite?: "Strict" | "Lax" | "None" } = {}
): void {
  const { secureCookie = false, sameSite = "Strict" } = config;
  const maxAge = 60 * 60 * 24; // 24 hours
  const secure = secureCookie ? "; Secure" : "";
  ctx.header(
    "Set-Cookie",
    `${CSRF_COOKIE_NAME}=${token}; Path=/; SameSite=${sameSite}; Max-Age=${maxAge}${secure}`
  );
}

/**
 * Parses the CSRF token value out of a Cookie header string.
 */
function parseCsrfCookie(cookieHeader: string): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name?.trim() === CSRF_COOKIE_NAME) {
      return valueParts.join("=").trim();
    }
  }
  return undefined;
}
