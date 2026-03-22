import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "../../packages/integrations/src/circuit-breaker.js";
import { InfrastructureError } from "../../packages/core/src/errors/domain-errors.js";

describe("CircuitBreaker", () => {
  describe("CLOSED state", () => {
    it("should execute a successful call and stay CLOSED", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, maxRetries: 0 });
      const result = await cb.call(async () => 42);
      expect(result).toBe(42);
      expect(cb.currentState).toBe("CLOSED");
    });

    it("should retry on failure and eventually succeed", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 5, maxRetries: 2, retryBaseDelayMs: 0 });
      let attempts = 0;
      const result = await cb.call(async () => {
        attempts++;
        if (attempts < 3) throw new Error("fail");
        return "ok";
      });
      expect(result).toBe("ok");
      expect(attempts).toBe(3);
    });

    it("should open the circuit after threshold consecutive failures", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 2, maxRetries: 0, retryBaseDelayMs: 0 });
      const fail = async () => {
        throw new Error("fail");
      };
      await expect(cb.call(fail)).rejects.toThrow("fail");
      await expect(cb.call(fail)).rejects.toThrow("fail");
      expect(cb.currentState).toBe("OPEN");
    });
  });

  describe("OPEN state", () => {
    it("should throw InfrastructureError when OPEN", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, maxRetries: 0, retryBaseDelayMs: 0 });
      await expect(cb.call(async () => { throw new Error("x"); })).rejects.toThrow();
      expect(cb.currentState).toBe("OPEN");
      await expect(cb.call(async () => 1)).rejects.toThrow(InfrastructureError);
    });
  });

  describe("HALF_OPEN state", () => {
    it("should transition to HALF_OPEN after recovery timeout", async () => {
      const now = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        maxRetries: 0,
        recoveryTimeoutMs: 1_000,
        retryBaseDelayMs: 0,
      });
      await expect(cb.call(async () => { throw new Error("x"); })).rejects.toThrow();
      expect(cb.currentState).toBe("OPEN");
      vi.setSystemTime(now + 1_001);
      expect(cb.currentState).toBe("HALF_OPEN");
      vi.useRealTimers();
    });

    it("should close after enough successes in HALF_OPEN", async () => {
      const now = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        maxRetries: 0,
        recoveryTimeoutMs: 100,
        halfOpenSuccessThreshold: 2,
        retryBaseDelayMs: 0,
      });
      await expect(cb.call(async () => { throw new Error("x"); })).rejects.toThrow();
      // Advance past recovery window so circuit transitions to HALF_OPEN
      vi.setSystemTime(now + 200);
      expect(cb.currentState).toBe("HALF_OPEN");

      await cb.call(async () => "ok");
      expect(cb.currentState).toBe("HALF_OPEN");
      await cb.call(async () => "ok");
      expect(cb.currentState).toBe("CLOSED");
      vi.useRealTimers();
    });
  });

  describe("reset()", () => {
    it("should reset to CLOSED regardless of state", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, maxRetries: 0, retryBaseDelayMs: 0 });
      await expect(cb.call(async () => { throw new Error(); })).rejects.toThrow();
      expect(cb.currentState).toBe("OPEN");
      cb.reset();
      expect(cb.currentState).toBe("CLOSED");
    });
  });

  describe("stats", () => {
    it("should track total calls and failures", async () => {
      const cb = new CircuitBreaker({ failureThreshold: 10, maxRetries: 0, retryBaseDelayMs: 0 });
      await cb.call(async () => 1);
      await expect(cb.call(async () => { throw new Error(); })).rejects.toThrow();
      const stats = cb.stats;
      expect(stats.totalCalls).toBe(2);
      expect(stats.totalFailures).toBe(1);
    });
  });
});
