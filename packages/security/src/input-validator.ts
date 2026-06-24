/**
 * Input validator — V2-13.
 * Multi-layer input sanitization pipeline that applies ordered validation stages:
 *   1. Syntax — encoding normalisation, length limits, format checks
 *   2. Semantics — schema / type validation using caller-supplied rules
 *   3. Intent — deferred to InjectionDetector (called externally by the pipeline owner)
 *
 * Each stage can reject the input early or annotate it with provenance metadata
 * for downstream tracing.
 */

import { ValidationError } from "../../core/src/errors/domain-errors.js";

export interface InputValidatorConfig {
  /** Maximum allowed byte length of the raw input string. Default: 32_768 (32 KB) */
  maxInputLength?: number;
  /** Whether to strip null bytes and control characters. Default: true */
  sanitizeControlChars?: boolean;
  /** Custom additional format validators keyed by field name */
  fieldValidators?: Record<string, FieldValidator>;
}

export type FieldValidator = (value: unknown) => string | null; // returns error message or null

export interface ValidatedInput {
  /** Sanitised input value */
  value: string;
  /** ISO-8601 timestamp of validation */
  validatedAt: string;
  /** Unique provenance ID for downstream tracing */
  provenanceId: string;
  /** Metadata annotations added during validation */
  annotations: Record<string, unknown>;
}

export interface ValidationStageResult {
  passed: boolean;
  stage: "syntax" | "semantics";
  errors: string[];
  annotations: Record<string, unknown>;
}

export class InputValidator {
  private readonly maxInputLength: number;
  private readonly sanitizeControlChars: boolean;
  private readonly fieldValidators: Record<string, FieldValidator>;

  constructor(config: InputValidatorConfig = {}) {
    this.maxInputLength = config.maxInputLength ?? 32_768;
    this.sanitizeControlChars = config.sanitizeControlChars ?? true;
    this.fieldValidators = config.fieldValidators ?? {};
  }

  /**
   * Run the full validation pipeline on a raw input string.
   * Throws `ValidationError` if any stage fails.
   * Returns a `ValidatedInput` with provenance metadata.
   */
  validate(raw: string, fieldName = "input"): ValidatedInput {
    const syntaxResult = this.runSyntaxStage(raw);
    if (!syntaxResult.passed) {
      throw new ValidationError(`Syntax validation failed for '${fieldName}'`, {
        [fieldName]: syntaxResult.errors,
      });
    }

    const sanitized = syntaxResult.annotations["sanitized"] as string;

    const semanticsResult = this.runSemanticsStage(sanitized, fieldName);
    if (!semanticsResult.passed) {
      throw new ValidationError(`Semantic validation failed for '${fieldName}'`, {
        [fieldName]: semanticsResult.errors,
      });
    }

    return {
      value: sanitized,
      validatedAt: new Date().toISOString(),
      provenanceId: crypto.randomUUID(),
      annotations: {
        ...syntaxResult.annotations,
        ...semanticsResult.annotations,
      },
    };
  }

  /**
   * Run only the syntax stage without throwing.
   * Useful for partial validation or diagnostic tooling.
   */
  runSyntaxStage(raw: string): ValidationStageResult {
    const errors: string[] = [];
    const annotations: Record<string, unknown> = {};

    if (typeof raw !== "string") {
      return { passed: false, stage: "syntax", errors: ["Input must be a string"], annotations };
    }

    const originalByteLength = Buffer.byteLength(raw, "utf8");
    if (originalByteLength > this.maxInputLength) {
      errors.push(`Input exceeds maximum length of ${this.maxInputLength} bytes`);
    }

    let sanitized = raw;
    if (this.sanitizeControlChars) {
      // Strip null bytes and non-printable ASCII control characters (except \t \n \r)
      sanitized = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
      if (sanitized.length !== raw.length) {
        annotations["controlCharsStripped"] = true;
      }
    }

    // Normalise unicode to NFC to prevent homoglyph attacks
    sanitized = sanitized.normalize("NFC");
    annotations["sanitized"] = sanitized;
    annotations["originalLength"] = raw.length;
    annotations["sanitizedLength"] = sanitized.length;
    annotations["originalByteLength"] = originalByteLength;
    annotations["sanitizedByteLength"] = Buffer.byteLength(sanitized, "utf8");

    return { passed: errors.length === 0, stage: "syntax", errors, annotations };
  }

  /**
   * Run only the semantics stage without throwing.
   * Applies registered field validators.
   */
  runSemanticsStage(value: string, fieldName = "input"): ValidationStageResult {
    const errors: string[] = [];
    const annotations: Record<string, unknown> = {};

    const validator = this.fieldValidators[fieldName];
    if (validator) {
      const err = validator(value);
      if (err) errors.push(err);
    }

    annotations["fieldValidated"] = Boolean(validator);
    return { passed: errors.length === 0, stage: "semantics", errors, annotations };
  }
}
