import { describe, it, expect } from "vitest";
import { RateLimiter } from "../../packages/security/src/rate-limiter.js";
import { RateLimitError } from "../../packages/core/src/errors/domain-errors.js";

describe("RateLimiter", () => {
  it("allows requests within limit", () => {
    const rl = new RateLimiter({ windows: [{ windowMs: 1000, maxRequests: 3 }] });
    expect(rl.consume("user-1").allowed).toBe(true);
    expect(rl.consume("user-1").allowed).toBe(true);
    expect(rl.consume("user-1").allowed).toBe(true);
  });

  it("denies request when limit exceeded", () => {
    const rl = new RateLimiter({ windows: [{ windowMs: 1000, maxRequests: 2 }] });
    rl.consume("user-1");
    rl.consume("user-1");
    const result = rl.consume("user-1");
    expect(result.allowed).toBe(false);
    expect(result.limitedByWindow).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets the window after the window duration", () => {
    const now = Date.now();
    const rl = new RateLimiter({ windows: [{ windowMs: 100, maxRequests: 1 }] });
    rl.consume("user-1", now);
    expect(rl.consume("user-1", now).allowed).toBe(false);
    // Advance time past window
    expect(rl.consume("user-1", now + 200).allowed).toBe(true);
  });

  it("tracks separate counts per key", () => {
    const rl = new RateLimiter({ windows: [{ windowMs: 1000, maxRequests: 1 }] });
    expect(rl.consume("alice").allowed).toBe(true);
    expect(rl.consume("bob").allowed).toBe(true);
    expect(rl.consume("alice").allowed).toBe(false);
  });

  it("check() throws RateLimitError on denial", () => {
    const rl = new RateLimiter({ windows: [{ windowMs: 1000, maxRequests: 1 }] });
    rl.consume("x");
    expect(() => rl.check("x")).toThrow(RateLimitError);
    expect(() => rl.check("x")).toThrow(/retry after/i);
  });

  it("bans key after abuseThreshold violations", () => {
    const now = Date.now();
    const rl = new RateLimiter({
      windows: [{ windowMs: 10_000, maxRequests: 1 }],
      abuseThreshold: 3,
      abuseWindowMs: 60_000,
      banDurationMs: 300_000,
    });
    rl.consume("bad", now); // allowed (fills quota)
    rl.consume("bad", now); // violation 1
    rl.consume("bad", now); // violation 2
    rl.consume("bad", now); // violation 3 → ban
    const banned = rl.consume("bad", now + 1);
    expect(banned.allowed).toBe(false);
    expect(banned.banExpiresAt).toBeDefined();
  });

  it("unban() lifts the ban", () => {
    const now = Date.now();
    const rl = new RateLimiter({
      windows: [{ windowMs: 10_000, maxRequests: 1 }],
      abuseThreshold: 2,
      banDurationMs: 600_000,
    });
    rl.consume("bad", now);
    rl.consume("bad", now); // violation 1
    rl.consume("bad", now); // violation 2 → ban
    rl.unban("bad");
    // After unban the window is still full, but the ban is lifted
    const result = rl.consume("bad", now + 1);
    expect(result.banExpiresAt).toBeUndefined();
  });

  it("unban() clears stale violations so the next violation does not immediately re-ban", () => {
    const now = Date.now();
    const rl = new RateLimiter({
      windows: [{ windowMs: 10_000, maxRequests: 1 }],
      abuseThreshold: 2,
      abuseWindowMs: 60_000,
      banDurationMs: 600_000,
    });

    rl.consume("bad", now);
    rl.consume("bad", now); // violation 1
    rl.consume("bad", now); // violation 2 -> ban
    rl.unban("bad");

    const result = rl.consume("bad", now + 1);
    expect(result.allowed).toBe(false);
    expect(result.banExpiresAt).toBeUndefined();
    expect(rl.getViolationCount("bad", now + 1)).toBe(1);
  });

  it("reset() clears all state for a key", () => {
    const rl = new RateLimiter({ windows: [{ windowMs: 1000, maxRequests: 1 }] });
    rl.consume("user");
    rl.consume("user");
    rl.reset("user");
    expect(rl.consume("user").allowed).toBe(true);
  });

  it("evicts idle window state after all windows expire", () => {
    const now = Date.now();
    const rl = new RateLimiter({ windows: [{ windowMs: 100, maxRequests: 1 }] });

    for (let i = 0; i < 100; i++) {
      rl.consume(`user-${i}`, now);
    }
    expect(rl.getWindowStateSize()).toBe(100);

    rl.sweep(now + 101);
    expect(rl.getWindowStateSize()).toBe(0);
  });

  it("evicts ban state after bans and abuse windows expire", () => {
    const now = Date.now();
    const rl = new RateLimiter({
      windows: [{ windowMs: 10_000, maxRequests: 1 }],
      abuseThreshold: 1,
      abuseWindowMs: 100,
      banDurationMs: 100,
    });

    for (let i = 0; i < 100; i++) {
      rl.consume(`bad-${i}`, now);
      rl.consume(`bad-${i}`, now);
    }
    expect(rl.getBanStateSize()).toBe(100);

    rl.sweep(now + 101);
    expect(rl.getBanStateSize()).toBe(0);
  });

  it("bounds retained state by maxKeys", () => {
    const now = Date.now();
    const rl = new RateLimiter({
      windows: [{ windowMs: 60_000, maxRequests: 1 }],
      abuseThreshold: 1,
      maxKeys: 10,
    });

    for (let i = 0; i < 50; i++) {
      rl.consume(`user-${i}`, now + i);
    }
    expect(rl.getWindowStateSize()).toBeLessThanOrEqual(10);

    for (let i = 0; i < 50; i++) {
      rl.consume(`bad-${i}`, now + 100 + i);
      rl.consume(`bad-${i}`, now + 100 + i);
    }
    expect(rl.getBanStateSize()).toBeLessThanOrEqual(10);
  });

  it("respects multiple windows simultaneously", () => {
    const now = Date.now();
    const rl = new RateLimiter({
      windows: [
        { windowMs: 1_000, maxRequests: 5 }, // 5/sec
        { windowMs: 60_000, maxRequests: 10 }, // 10/min
      ],
    });
    // Exhaust the per-minute window without hitting per-second
    for (let i = 0; i < 5; i++) rl.consume("u", now + i * 200); // spread over 5 different seconds
    // Need to advance time to avoid hitting the per-second window
    for (let i = 0; i < 5; i++) rl.consume("u", now + 10_000 + i * 200);
    // Now the per-minute limit is exhausted
    const over = rl.consume("u", now + 20_000);
    expect(over.allowed).toBe(false);
  });

  it("does not persist an expired sibling window reset when another window denies", () => {
    const now = Date.now();
    const rl = new RateLimiter({
      windows: [
        { windowMs: 1_000, maxRequests: 1 },
        { windowMs: 60_000, maxRequests: 2 },
      ],
    });

    expect(rl.consume("u", now).allowed).toBe(true);
    expect(rl.consume("u", now + 1_500).allowed).toBe(true);

    const denied = rl.consume("u", now + 3_000);
    expect(denied.allowed).toBe(false);
    expect(denied.limitedByWindow).toBe(1);

    const stillDenied = rl.consume("u", now + 3_500);
    expect(stillDenied.allowed).toBe(false);
    expect(stillDenied.limitedByWindow).toBe(1);
    expect(stillDenied.resetAt).toBe(now + 60_000);
  });

  it("getViolationCount returns 0 for a clean key", () => {
    const rl = new RateLimiter({ windows: [{ windowMs: 1000, maxRequests: 10 }] });
    expect(rl.getViolationCount("clean")).toBe(0);
  });

  it("requires at least one window configuration", () => {
    expect(() => new RateLimiter({ windows: [] })).toThrow();
  });
});
