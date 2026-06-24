import type { MiddlewareHandler } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import type Database from "better-sqlite3";
import { initSecurity } from "../../services/security.js";
import {
  safeCompare,
  COOKIE_NAME,
  ACTIVITY_COOKIE_NAME,
  DEFAULT_INACTIVITY_TIMEOUT_SECONDS,
} from "./auth.js";

interface WebUIApiAuthDeps {
  memory: {
    db: Database.Database;
  };
}

export function createWebUIApiAuthMiddleware(
  deps: WebUIApiAuthDeps,
  authToken: string,
  updateActivityCookie: (c: unknown) => void
): MiddlewareHandler {
  return async (c, next) => {
    // Resolve inactivity timeout from security settings (fallback to default)
    let inactivityTimeoutSeconds: number | null = DEFAULT_INACTIVITY_TIMEOUT_SECONDS;
    try {
      const security = initSecurity(deps.memory.db);
      const settings = security.getSettings();
      inactivityTimeoutSeconds =
        settings.session_timeout_minutes !== null ? settings.session_timeout_minutes * 60 : null; // null = no timeout
    } catch {
      // If DB is unavailable, fall back to default timeout
    }

    // 1. Check HttpOnly session cookie (primary — browser)
    const cookieToken = getCookie(c, COOKIE_NAME);
    if (cookieToken && safeCompare(cookieToken, authToken)) {
      // Enforce inactivity timeout via last-activity cookie
      if (inactivityTimeoutSeconds !== null) {
        const lastActivityRaw = getCookie(c, ACTIVITY_COOKIE_NAME);
        if (lastActivityRaw) {
          const lastActivity = parseInt(lastActivityRaw, 10);
          const now = Math.floor(Date.now() / 1000);
          if (!isNaN(lastActivity) && now - lastActivity > inactivityTimeoutSeconds) {
            deleteCookie(c, COOKIE_NAME, { path: "/" });
            deleteCookie(c, ACTIVITY_COOKIE_NAME, { path: "/" });
            return c.json({ success: false, error: "Session expired due to inactivity" }, 401);
          }
        }
        // Update last activity on every authenticated request
        updateActivityCookie(c);
      }
      return next();
    }

    // 2. Check Authorization header (secondary — API/curl)
    const authHeader = c.req.header("Authorization");
    if (authHeader) {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match && safeCompare(match[1], authToken)) {
        return next();
      }
    }

    return c.json({ success: false, error: "Unauthorized" }, 401);
  };
}
