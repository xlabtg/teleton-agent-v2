/**
 * Error Classifier — V2-10.
 * Categorises execution errors by type and recoverability so the
 * self-correction loop can pick an appropriate recovery strategy.
 *
 * Error categories are deliberately narrow: new categories should only be
 * added when an actual recovery strategy exists for them.
 */

export type ErrorCategory =
  | "timeout"
  | "rate_limit"
  | "validation"
  | "auth"
  | "not_found"
  | "network"
  | "data_corruption"
  | "unknown";

/** Errors in this set should NEVER be auto-corrected. */
const NON_RECOVERABLE: Set<ErrorCategory> = new Set(["auth", "data_corruption"]);

export interface ClassificationResult {
  category: ErrorCategory;
  /** True when an auto-correction strategy may be attempted. */
  isRecoverable: boolean;
  /** Suggested maximum auto-correction attempts for this category. */
  suggestedMaxRetries: number;
}

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: ErrorCategory; maxRetries: number }> = [
  { pattern: /timeout|timed?\s*out/i, category: "timeout", maxRetries: 3 },
  { pattern: /rate.?limit|too\s+many\s+requests|429/i, category: "rate_limit", maxRetries: 5 },
  { pattern: /auth|unauthorized|forbidden|401|403/i, category: "auth", maxRetries: 0 },
  { pattern: /corrupt|checksum|integrity/i, category: "data_corruption", maxRetries: 0 },
  { pattern: /validation|schema|format|parse/i, category: "validation", maxRetries: 2 },
  { pattern: /not\s+found|404|missing/i, category: "not_found", maxRetries: 1 },
  {
    pattern: /network|connect|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i,
    category: "network",
    maxRetries: 3,
  },
];

export class ErrorClassifier {
  /**
   * Classify an error message or Error object.
   */
  classify(error: unknown): ClassificationResult {
    const message = this.extractMessage(error);

    for (const { pattern, category, maxRetries } of CATEGORY_PATTERNS) {
      if (pattern.test(message)) {
        return {
          category,
          isRecoverable: !NON_RECOVERABLE.has(category),
          suggestedMaxRetries: maxRetries,
        };
      }
    }

    return { category: "unknown", isRecoverable: true, suggestedMaxRetries: 1 };
  }

  private extractMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error);
  }
}
