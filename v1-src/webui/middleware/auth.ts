import { randomBytes, timingSafeEqual } from "node:crypto";

/** Cookie name for HttpOnly session */
export const COOKIE_NAME = "teleton_session";

/** Cookie name for tracking last activity timestamp (non-HttpOnly so JS can read for UX) */
export const ACTIVITY_COOKIE_NAME = "teleton_last_activity";

/** Max age for session cookie (24 hours in seconds, per security best practices) */
export const COOKIE_MAX_AGE = 24 * 60 * 60;

/** Default session inactivity timeout (30 minutes in seconds) */
export const DEFAULT_INACTIVITY_TIMEOUT_SECONDS = 30 * 60;

/** Generate a 32-byte base64url token for API auth */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Mask a token for safe display in logs.
 * Shows first 4 + last 4 characters: "abcd...wxyz".
 * Tokens shorter than 12 chars are fully masked.
 */
export function maskToken(token: string): string {
  if (token.length < 12) return "****";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

/**
 * Timing-safe token comparison to prevent side-channel attacks.
 * Returns false for empty or mismatched-length tokens.
 */
export function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
