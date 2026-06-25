import { describe, it, expect } from "vitest";
import { ErrorClassifier } from "../../packages/agents/src/error-classifier.js";
import { CorrectionStrategyRegistry } from "../../packages/agents/src/correction-strategies.js";
import { CorrectionHistory } from "../../packages/agents/src/correction-history.js";
import { SelfCorrection } from "../../packages/agents/src/self-correction.js";

// ── ErrorClassifier ──────────────────────────────────────────────────────────

describe("ErrorClassifier", () => {
  const classifier = new ErrorClassifier();

  it("should classify timeout errors", () => {
    const r = classifier.classify(new Error("Request timed out"));
    expect(r.category).toBe("timeout");
    expect(r.isRecoverable).toBe(true);
  });

  it("should classify rate-limit errors", () => {
    const r = classifier.classify(new Error("429 Too Many Requests"));
    expect(r.category).toBe("rate_limit");
    expect(r.isRecoverable).toBe(true);
  });

  it("should classify auth errors as non-recoverable", () => {
    const r = classifier.classify(new Error("401 Unauthorized"));
    expect(r.category).toBe("auth");
    expect(r.isRecoverable).toBe(false);
  });

  it("should classify invalid auth messages as non-recoverable auth errors", () => {
    for (const message of ["Invalid auth token", "Invalid session: unauthorized", "unauthorized"]) {
      const r = classifier.classify(new Error(message));
      expect(r.category).toBe("auth");
      expect(r.isRecoverable).toBe(false);
      expect(r.suggestedMaxRetries).toBe(0);
    }
  });

  it("should classify data corruption as non-recoverable", () => {
    const r = classifier.classify(new Error("Checksum integrity failure"));
    expect(r.category).toBe("data_corruption");
    expect(r.isRecoverable).toBe(false);
  });

  it("should classify invalid integrity messages as non-recoverable data corruption", () => {
    for (const message of ["invalid checksum", "integrity violation"]) {
      const r = classifier.classify(new Error(message));
      expect(r.category).toBe("data_corruption");
      expect(r.isRecoverable).toBe(false);
      expect(r.suggestedMaxRetries).toBe(0);
    }
  });

  it("should classify network errors", () => {
    const r = classifier.classify(new Error("ECONNREFUSED"));
    expect(r.category).toBe("network");
    expect(r.isRecoverable).toBe(true);
  });

  it("should return unknown category for unrecognised errors", () => {
    const r = classifier.classify(new Error("something went wrong"));
    expect(r.category).toBe("unknown");
    expect(r.isRecoverable).toBe(true);
  });

  it("should handle string errors", () => {
    const r = classifier.classify("validation error: schema mismatch");
    expect(r.category).toBe("validation");
  });
});

// ── CorrectionStrategyRegistry ───────────────────────────────────────────────

describe("CorrectionStrategyRegistry", () => {
  it("should return shouldRetry=true for timeout strategy", async () => {
    const reg = new CorrectionStrategyRegistry();
    const result = await reg.apply({
      operationName: "op",
      errorCategory: "timeout",
      error: new Error("timed out"),
      attempt: 1,
      executionContext: {},
    });
    expect(result.shouldRetry).toBe(true);
  });

  it("should allow overriding built-in strategies", async () => {
    const reg = new CorrectionStrategyRegistry();
    reg.register("timeout", async () => ({
      updatedContext: {},
      description: "custom",
      shouldRetry: false,
    }));
    const result = await reg.apply({
      operationName: "op",
      errorCategory: "timeout",
      error: new Error("t"),
      attempt: 1,
      executionContext: {},
    });
    expect(result.shouldRetry).toBe(false);
    expect(result.description).toBe("custom");
  });

  it("should return shouldRetry=false for unregistered category", async () => {
    const reg = new CorrectionStrategyRegistry();
    // "auth" has no built-in strategy entry — but let's test with a truly missing one.
    // Remove a registered strategy to test the fallback path.
    const result = await reg.apply({
      operationName: "op",
      errorCategory: "auth",
      error: new Error("forbidden"),
      attempt: 1,
      executionContext: {},
    });
    expect(result.shouldRetry).toBe(false);
  });
});

// ── CorrectionHistory ────────────────────────────────────────────────────────

describe("CorrectionHistory", () => {
  it("should record and retrieve correction records", () => {
    const history = new CorrectionHistory();
    history.record({
      operationName: "op1",
      errorCategory: "timeout",
      errorMessage: "timed out",
      attempt: 1,
      strategyDescription: "backoff",
      succeeded: false,
    });
    expect(history.getForOperation("op1").length).toBe(1);
  });

  it("should count consecutive failures correctly", () => {
    const history = new CorrectionHistory();
    history.record({
      operationName: "op1",
      errorCategory: "network",
      errorMessage: "err",
      attempt: 1,
      strategyDescription: "backoff",
      succeeded: false,
    });
    history.record({
      operationName: "op1",
      errorCategory: "network",
      errorMessage: "err",
      attempt: 2,
      strategyDescription: "backoff",
      succeeded: false,
    });
    history.record({
      operationName: "op1",
      errorCategory: "network",
      errorMessage: "err",
      attempt: 3,
      strategyDescription: "backoff",
      succeeded: true,
    });
    expect(history.consecutiveFailures("op1")).toBe(0); // last was success
  });

  it("should evict old records beyond maxRecordsPerOperation", () => {
    const history = new CorrectionHistory({ maxRecordsPerOperation: 3 });
    for (let i = 0; i < 5; i++) {
      history.record({
        operationName: "op1",
        errorCategory: "unknown",
        errorMessage: "",
        attempt: i + 1,
        strategyDescription: "",
        succeeded: false,
      });
    }
    expect(history.getForOperation("op1").length).toBe(3);
  });

  it("lastSuccessfulStrategy returns most recent successful strategy", () => {
    const history = new CorrectionHistory();
    history.record({
      operationName: "op",
      errorCategory: "timeout",
      errorMessage: "",
      attempt: 1,
      strategyDescription: "approach-A",
      succeeded: true,
    });
    expect(history.lastSuccessfulStrategy("op", "timeout")).toBe("approach-A");
  });
});

// ── SelfCorrection ───────────────────────────────────────────────────────────

describe("SelfCorrection", () => {
  it("should return success on first attempt", async () => {
    const sc = new SelfCorrection({ maxRetries: 3 });
    const result = await sc.run("op", async () => 42);
    expect(result.success).toBe(true);
    expect(result.output).toBe(42);
    expect(result.attempts).toBe(1);
  });

  it("should retry and succeed on later attempt", async () => {
    const sc = new SelfCorrection({ maxRetries: 3 });
    let calls = 0;
    const result = await sc.run("op", async () => {
      if (++calls < 3) throw new Error("network ECONNREFUSED");
      return "recovered";
    });
    expect(result.success).toBe(true);
    expect(result.output).toBe("recovered");
    expect(result.attempts).toBe(3);
    expect(result.corrections.length).toBeGreaterThan(0);
  });

  it("should not retry non-recoverable errors", async () => {
    const sc = new SelfCorrection({ maxRetries: 5 });
    let calls = 0;
    const result = await sc.run("op", async () => {
      calls++;
      throw new Error("401 Unauthorized");
    });
    expect(result.success).toBe(false);
    expect(calls).toBe(1); // no retries
    expect(result.error).toContain("auth");
  });

  it("should exhaust retries and return failure", async () => {
    const sc = new SelfCorrection({ maxRetries: 2 });
    const result = await sc.run("op", async () => {
      throw new Error("Request timed out");
    });
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3); // initial + 2 retries
  });

  it("should open circuit breaker after threshold failures", async () => {
    const history = new CorrectionHistory();
    // Simulate already-failed attempts beyond threshold
    for (let i = 0; i < 10; i++) {
      history.record({
        operationName: "op",
        errorCategory: "timeout",
        errorMessage: "t",
        attempt: i + 1,
        strategyDescription: "",
        succeeded: false,
      });
    }
    const sc = new SelfCorrection({ maxRetries: 5, circuitBreakerThreshold: 10, history });
    const result = await sc.run("op", async () => "ok");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Circuit breaker");
  });
});
