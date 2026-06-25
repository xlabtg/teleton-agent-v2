/**
 * Self-Correction Loop — V2-10.
 * Detects execution errors, classifies them, applies a recovery strategy,
 * and retries the operation. A circuit-breaker prevents infinite loops.
 *
 * Hard constraints:
 *  - Auth and data-corruption errors are NEVER auto-corrected.
 *  - Retry attempts are always capped by `maxRetries`.
 *  - Every correction attempt is recorded in CorrectionHistory.
 */

import { ErrorClassifier } from "./error-classifier.js";
import { CorrectionStrategyRegistry } from "./correction-strategies.js";
import { CorrectionHistory } from "./correction-history.js";

export type OperationFn<T> = (context: Record<string, unknown>) => Promise<T>;

const INTERNAL_CONTEXT_KEYS = new Set([
  "_rateLimitBackoffMs",
  "_needsRephrase",
  "_relaxConstraints",
]);

export interface SelfCorrectionConfig {
  /**
   * Absolute maximum retries regardless of error category or strategy
   * suggestions. Default: 5.
   */
  maxRetries?: number;
  /**
   * Maximum consecutive failures for the same operation before the
   * circuit-breaker opens and further attempts are blocked. Default: 10.
   */
  circuitBreakerThreshold?: number;
  classifier?: ErrorClassifier;
  strategyRegistry?: CorrectionStrategyRegistry;
  history?: CorrectionHistory;
}

export interface SelfCorrectionResult<T> {
  success: boolean;
  output?: T;
  error?: string;
  attempts: number;
  corrections: string[];
}

export class SelfCorrection {
  private readonly maxRetries: number;
  private readonly circuitBreakerThreshold: number;
  private readonly classifier: ErrorClassifier;
  private readonly strategyRegistry: CorrectionStrategyRegistry;
  private readonly history: CorrectionHistory;

  constructor(config: SelfCorrectionConfig = {}) {
    this.maxRetries = config.maxRetries ?? 5;
    this.circuitBreakerThreshold = config.circuitBreakerThreshold ?? 10;
    this.classifier = config.classifier ?? new ErrorClassifier();
    this.strategyRegistry = config.strategyRegistry ?? new CorrectionStrategyRegistry();
    this.history = config.history ?? new CorrectionHistory();
  }

  /**
   * Execute `operation` with automatic self-correction on failure.
   *
   * @param operationName  Human-readable identifier used in history and logs.
   * @param operation      The async function to execute; receives the current
   *                       (possibly mutated) context on each attempt.
   * @param initialContext Shared context passed into the operation.
   */
  async run<T>(
    operationName: string,
    operation: OperationFn<T>,
    initialContext: Record<string, unknown> = {}
  ): Promise<SelfCorrectionResult<T>> {
    // Circuit-breaker check.
    if (this.history.consecutiveFailures(operationName) >= this.circuitBreakerThreshold) {
      return {
        success: false,
        error: `Circuit breaker open for "${operationName}": too many consecutive failures`,
        attempts: 0,
        corrections: [],
      };
    }

    let context = { ...initialContext };
    const corrections: string[] = [];
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      try {
        const output = await operation(this.toOperationContext(context));

        // Record success if this wasn't the first attempt.
        if (attempt > 1) {
          this.history.record({
            operationName,
            errorCategory: "unknown",
            errorMessage: "",
            attempt,
            strategyDescription: corrections[corrections.length - 1] ?? "",
            succeeded: true,
          });
        }

        return { success: true, output, attempts: attempt, corrections };
      } catch (err) {
        lastError = err;
        const classification = this.classifier.classify(err);

        // Non-recoverable errors are escalated immediately.
        if (!classification.isRecoverable) {
          this.history.record({
            operationName,
            errorCategory: classification.category,
            errorMessage: String(err),
            attempt,
            strategyDescription: "non-recoverable — escalated",
            succeeded: false,
          });

          return {
            success: false,
            error: `Non-recoverable error (${classification.category}): ${String(err)}`,
            attempts: attempt,
            corrections,
          };
        }

        const effectiveMaxRetries = Math.min(this.maxRetries, classification.suggestedMaxRetries);

        // Exhausted retries.
        if (attempt > effectiveMaxRetries) {
          return {
            success: false,
            error: String(lastError),
            attempts: attempt,
            corrections,
          };
        }

        // Apply correction strategy.
        const correctionResult = await this.strategyRegistry.apply({
          operationName,
          errorCategory: classification.category,
          error: err,
          attempt,
          executionContext: context,
        });

        this.history.record({
          operationName,
          errorCategory: classification.category,
          errorMessage: String(err),
          attempt,
          strategyDescription: correctionResult.description,
          succeeded: false,
        });

        if (!correctionResult.shouldRetry) {
          break;
        }

        context = correctionResult.updatedContext;
        corrections.push(correctionResult.description);

        // Honour rate-limit backoff hint if set.
        const rateLimitBackoffMs = context["_rateLimitBackoffMs"] as number | undefined;
        context = this.toOperationContext(context);
        const backoffMs =
          rateLimitBackoffMs ??
          (classification.category === "timeout" || classification.category === "network"
            ? Math.min(30_000, 500 * Math.pow(2, attempt - 1))
            : 0);

        if (backoffMs > 0) {
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }
    }

    return {
      success: false,
      error: String(lastError),
      attempts: this.maxRetries + 1,
      corrections,
    };
  }

  /** Expose the underlying history store for inspection. */
  get correctionHistory(): CorrectionHistory {
    return this.history;
  }

  private toOperationContext(context: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(context).filter(([key]) => !INTERNAL_CONTEXT_KEYS.has(key))
    );
  }
}
