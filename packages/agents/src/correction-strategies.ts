/**
 * Correction Strategies — V2-10.
 * A registry of pluggable recovery strategies mapped to error categories.
 * Each strategy receives the failed execution context and returns a modified
 * context that the self-correction loop will use for the next attempt.
 */

import type { ErrorCategory } from "./error-classifier.js";

export interface CorrectionContext {
  /** Step or task name that failed. */
  operationName: string;
  /** Error category determined by the ErrorClassifier. */
  errorCategory: ErrorCategory;
  /** The original error. */
  error: unknown;
  /** Attempt number (1-based). */
  attempt: number;
  /** Execution context that may be mutated by the strategy. */
  executionContext: Record<string, unknown>;
}

export interface CorrectionResult {
  /** Modified context for the next attempt. */
  updatedContext: Record<string, unknown>;
  /** Human-readable explanation of what was adjusted. */
  description: string;
  /** Whether the strategy believes a retry is worthwhile. */
  shouldRetry: boolean;
}

export type CorrectionStrategy = (
  ctx: CorrectionContext
) => CorrectionResult | Promise<CorrectionResult>;

/** Default strategy: wait using exponential backoff, then retry as-is. */
export const backoffStrategy: CorrectionStrategy = (ctx) => ({
  updatedContext: ctx.executionContext,
  description: `Backoff on attempt ${ctx.attempt} for "${ctx.errorCategory}" error`,
  shouldRetry: true,
});

/** Rate-limit strategy: add a longer delay hint to the context. */
export const rateLimitStrategy: CorrectionStrategy = (ctx) => ({
  updatedContext: {
    ...ctx.executionContext,
    _rateLimitBackoffMs: Math.min(60_000, 1_000 * Math.pow(2, ctx.attempt)),
  },
  description: `Rate-limit: scheduled backoff of ${Math.min(60_000, 1_000 * Math.pow(2, ctx.attempt))}ms`,
  shouldRetry: true,
});

/** Validation strategy: flag the context so a rephrasing pass can be attempted. */
export const validationStrategy: CorrectionStrategy = (ctx) => ({
  updatedContext: { ...ctx.executionContext, _needsRephrase: true },
  description: "Validation error: flagged context for prompt rephrasing",
  shouldRetry: ctx.attempt <= 2,
});

/** Not-found strategy: attempt without optional fields. */
export const notFoundStrategy: CorrectionStrategy = (ctx) => ({
  updatedContext: { ...ctx.executionContext, _relaxConstraints: true },
  description: "Not-found: retrying with relaxed constraints",
  shouldRetry: ctx.attempt === 1,
});

export class CorrectionStrategyRegistry {
  private readonly strategies = new Map<ErrorCategory, CorrectionStrategy>();

  constructor() {
    // Register built-in defaults.
    this.register("timeout", backoffStrategy);
    this.register("network", backoffStrategy);
    this.register("rate_limit", rateLimitStrategy);
    this.register("validation", validationStrategy);
    this.register("not_found", notFoundStrategy);
    this.register("unknown", backoffStrategy);
  }

  register(category: ErrorCategory, strategy: CorrectionStrategy): void {
    this.strategies.set(category, strategy);
  }

  /** Returns the strategy for the category, or undefined if none registered. */
  get(category: ErrorCategory): CorrectionStrategy | undefined {
    return this.strategies.get(category);
  }

  /** Apply the strategy for the given context and return the result. */
  async apply(ctx: CorrectionContext): Promise<CorrectionResult> {
    const strategy = this.strategies.get(ctx.errorCategory);
    if (!strategy) {
      return {
        updatedContext: ctx.executionContext,
        description: `No strategy for category "${ctx.errorCategory}"; passing through`,
        shouldRetry: false,
      };
    }
    return strategy(ctx);
  }
}
