/**
 * Circuit Breaker — V2-15.
 * Implements the circuit breaker pattern with exponential backoff retry.
 * States: CLOSED (normal) → OPEN (failing) → HALF_OPEN (probing) → CLOSED.
 */

import { InfrastructureError } from "../../core/src/errors/domain-errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  /**
   * Number of consecutive failures before opening the circuit.
   * Defaults to 5.
   */
  failureThreshold?: number;
  /**
   * Milliseconds to wait in OPEN state before probing with a single request.
   * Defaults to 30 000 (30 s).
   */
  recoveryTimeoutMs?: number;
  /**
   * Number of consecutive successes in HALF_OPEN state needed to close the circuit.
   * Defaults to 2.
   */
  halfOpenSuccessThreshold?: number;
  /**
   * Maximum number of retry attempts per call (before incrementing the failure counter).
   * Defaults to 3.
   */
  maxRetries?: number;
  /**
   * Base delay in milliseconds for exponential backoff.
   * Defaults to 200.
   */
  retryBaseDelayMs?: number;
  /**
   * Cap on backoff delay.
   * Defaults to 10 000 (10 s).
   */
  retryMaxDelayMs?: number;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  totalCalls: number;
  totalFailures: number;
}

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

/**
 * Wraps an async operation with circuit breaker and retry semantics.
 *
 * @example
 * const cb = new CircuitBreaker({ failureThreshold: 3 });
 * const result = await cb.call(() => fetch("https://api.example.com/data"));
 */
export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private halfOpenSuccessCount = 0;
  private lastFailureAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private openedAt: Date | null = null;
  private totalCalls = 0;
  private totalFailures = 0;

  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly halfOpenSuccessThreshold: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;

  constructor(config: CircuitBreakerConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? 5;
    this.recoveryTimeoutMs = config.recoveryTimeoutMs ?? 30_000;
    this.halfOpenSuccessThreshold = config.halfOpenSuccessThreshold ?? 2;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 200;
    this.retryMaxDelayMs = config.retryMaxDelayMs ?? 10_000;
  }

  /** Current circuit state. */
  get currentState(): CircuitState {
    return this._effectiveState();
  }

  /** Snapshot of breaker statistics. */
  get stats(): CircuitBreakerStats {
    return {
      state: this._effectiveState(),
      failureCount: this.failureCount,
      successCount: this.halfOpenSuccessCount,
      lastFailureAt: this.lastFailureAt?.toISOString() ?? null,
      lastSuccessAt: this.lastSuccessAt?.toISOString() ?? null,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
    };
  }

  /**
   * Execute `fn` through the circuit breaker with automatic retry.
   * Throws `InfrastructureError` if the circuit is OPEN.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    this._maybeTransitionToHalfOpen();
    this.totalCalls++;

    if (this.state === "OPEN") {
      throw new InfrastructureError(
        "Circuit breaker is OPEN. Requests are blocked until recovery timeout elapses.",
        new Error("Circuit open")
      );
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(backoffDelay(attempt, this.retryBaseDelayMs, this.retryMaxDelayMs));
      }
      try {
        const result = await fn();
        this._onSuccess();
        return result;
      } catch (err) {
        lastError = err;
      }
    }

    this._onFailure();
    throw lastError;
  }

  /** Manually reset the circuit to CLOSED state. */
  reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.halfOpenSuccessCount = 0;
    this.openedAt = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _onSuccess(): void {
    this.lastSuccessAt = new Date();
    if (this.state === "HALF_OPEN") {
      this.halfOpenSuccessCount++;
      if (this.halfOpenSuccessCount >= this.halfOpenSuccessThreshold) {
        this.state = "CLOSED";
        this.failureCount = 0;
        this.halfOpenSuccessCount = 0;
        this.openedAt = null;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private _onFailure(): void {
    this.lastFailureAt = new Date();
    this.totalFailures++;
    if (this.state === "HALF_OPEN") {
      // Probe failed — reopen.
      this.state = "OPEN";
      this.openedAt = new Date();
      this.halfOpenSuccessCount = 0;
    } else {
      this.failureCount++;
      if (this.failureCount >= this.failureThreshold) {
        this.state = "OPEN";
        this.openedAt = new Date();
      }
    }
  }

  private _maybeTransitionToHalfOpen(): void {
    if (this.state === "OPEN" && this._effectiveState() === "HALF_OPEN") {
      this.state = "HALF_OPEN";
      this.halfOpenSuccessCount = 0;
    }
  }

  private _effectiveState(now = Date.now()): CircuitState {
    if (
      this.state === "OPEN" &&
      this.openedAt !== null &&
      now - this.openedAt.getTime() >= this.recoveryTimeoutMs
    ) {
      return "HALF_OPEN";
    }
    return this.state;
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function backoffDelay(attempt: number, base: number, cap: number): number {
  const delay = base * Math.pow(2, attempt - 1);
  return Math.min(delay, cap);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
