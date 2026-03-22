/**
 * Rate limiter — V2-13.
 * Token-bucket rate limiter with configurable windows and thresholds.
 * Supports per-key (per-IP or per-user) limiting, global limits, and abuse detection
 * (automatic temporary banning after excessive violations).
 */

import { RateLimitError } from "../../core/src/errors/domain-errors.js";

export interface RateLimitWindow {
  /** Window duration in milliseconds */
  windowMs: number;
  /** Maximum requests allowed within the window */
  maxRequests: number;
}

export interface RateLimiterConfig {
  /** Rate limit windows to enforce (checked in order). At least one is required. */
  windows: RateLimitWindow[];
  /** Number of violations within `abuseWindowMs` that trigger a temporary ban. Default: 10 */
  abuseThreshold?: number;
  /** Window for tracking violations (ms). Default: 60_000 (1 min) */
  abuseWindowMs?: number;
  /** Duration of the temporary ban (ms). Default: 300_000 (5 min) */
  banDurationMs?: number;
}

export interface RateLimitStatus {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Key that was checked */
  key: string;
  /** Window index that triggered the limit (if denied) */
  limitedByWindow?: number;
  /** Number of requests remaining in the most restrictive window */
  remaining: number;
  /** Unix ms timestamp when the current window resets */
  resetAt: number;
  /** If banned, when the ban expires */
  banExpiresAt?: number;
  /** Suggested retry-after in seconds (for HTTP headers) */
  retryAfterSeconds: number;
}

interface WindowState {
  count: number;
  windowStart: number;
}

interface BanState {
  violations: number[];  // timestamps
  bannedUntil?: number;
}

export class RateLimiter {
  /** Map of key → per-window counts */
  private readonly windowStates = new Map<string, WindowState[]>();
  /** Map of key → abuse/ban tracking */
  private readonly banStates = new Map<string, BanState>();

  private readonly windows: RateLimitWindow[];
  private readonly abuseThreshold: number;
  private readonly abuseWindowMs: number;
  private readonly banDurationMs: number;

  constructor(config: RateLimiterConfig) {
    if (!config.windows.length) {
      throw new Error("RateLimiter requires at least one window configuration");
    }
    this.windows = config.windows;
    this.abuseThreshold = config.abuseThreshold ?? 10;
    this.abuseWindowMs = config.abuseWindowMs ?? 60_000;
    this.banDurationMs = config.banDurationMs ?? 300_000;
  }

  /**
   * Check whether the key is within rate limits and consume one request token.
   * Returns a `RateLimitStatus` — does not throw.
   */
  consume(key: string, now = Date.now()): RateLimitStatus {
    // Check ban
    const ban = this.banStates.get(key);
    if (ban?.bannedUntil && ban.bannedUntil > now) {
      return {
        allowed: false,
        key,
        remaining: 0,
        resetAt: ban.bannedUntil,
        banExpiresAt: ban.bannedUntil,
        retryAfterSeconds: Math.ceil((ban.bannedUntil - now) / 1000),
      };
    }

    let states = this.windowStates.get(key);
    if (!states) {
      states = this.windows.map(() => ({ count: 0, windowStart: now }));
      this.windowStates.set(key, states);
    }

    let limitedByWindow: number | undefined;
    let minRemaining = Infinity;
    let resetAt = 0;

    // Evaluate each window
    for (let i = 0; i < this.windows.length; i++) {
      const win = this.windows[i];
      const state = states[i];

      // Reset window if expired
      if (now - state.windowStart >= win.windowMs) {
        state.count = 0;
        state.windowStart = now;
      }

      const remaining = win.maxRequests - state.count - 1; // -1 for this request
      const windowReset = state.windowStart + win.windowMs;

      if (remaining < minRemaining) {
        minRemaining = remaining;
        resetAt = windowReset;
      }

      if (state.count >= win.maxRequests) {
        limitedByWindow = i;
        break;
      }
    }

    if (limitedByWindow !== undefined) {
      this.recordViolation(key, now);
      return {
        allowed: false,
        key,
        limitedByWindow,
        remaining: 0,
        resetAt,
        retryAfterSeconds: Math.ceil((resetAt - now) / 1000),
      };
    }

    // All windows passed — consume
    for (const state of states) {
      state.count++;
    }

    return {
      allowed: true,
      key,
      remaining: Math.max(0, minRemaining),
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  /**
   * Like `consume` but throws `RateLimitError` when the limit is exceeded.
   */
  check(key: string, now = Date.now()): void {
    const status = this.consume(key, now);
    if (!status.allowed) {
      throw new RateLimitError(status.retryAfterSeconds);
    }
  }

  /**
   * Manually lift a ban for the given key.
   */
  unban(key: string): void {
    const ban = this.banStates.get(key);
    if (ban) {
      ban.bannedUntil = undefined;
    }
  }

  /**
   * Reset all state for a key (useful in tests).
   */
  reset(key: string): void {
    this.windowStates.delete(key);
    this.banStates.delete(key);
  }

  /** Current violation count for a key within the abuse window */
  getViolationCount(key: string, now = Date.now()): number {
    const ban = this.banStates.get(key);
    if (!ban) return 0;
    return ban.violations.filter((t) => now - t <= this.abuseWindowMs).length;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private recordViolation(key: string, now: number): void {
    let ban = this.banStates.get(key);
    if (!ban) {
      ban = { violations: [] };
      this.banStates.set(key, ban);
    }

    // Purge old violations outside the abuse window
    ban.violations = ban.violations.filter((t) => now - t <= this.abuseWindowMs);
    ban.violations.push(now);

    if (ban.violations.length >= this.abuseThreshold) {
      ban.bannedUntil = now + this.banDurationMs;
    }
  }
}
