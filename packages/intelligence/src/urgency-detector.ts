/**
 * Urgency Detector — V2-11.
 * Detects deadlines and urgency signals in text and context items, and
 * assigns a priority level based on proximity of the deadline to the
 * reference time.
 */

import { TimeParser } from "./time-parser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UrgencyLevel = "critical" | "high" | "normal" | "low";

/** A detected deadline or urgency signal. */
export interface UrgencySignal {
  /** The raw text fragment that triggered the detection. */
  raw: string;
  /** Resolved deadline date (if a time expression was found). */
  deadline?: Date;
  /** Time remaining until the deadline in milliseconds. Negative = overdue. */
  timeRemainingMs?: number;
  /** Assigned urgency level. */
  level: UrgencyLevel;
  /** The keyword or pattern that triggered detection. */
  trigger: string;
}

export interface UrgencyDetectorConfig {
  /**
   * Override the reference clock. Defaults to Date.now().
   */
  referenceDate?: Date;

  /**
   * Thresholds (in ms) that map time-remaining to urgency levels.
   * If timeRemaining ≤ threshold.critical → "critical", etc.
   * Defaults: critical=1h, high=24h, normal=72h, anything beyond → "low".
   */
  thresholds?: {
    criticalMs?: number;
    highMs?: number;
    normalMs?: number;
  };
}

// ---------------------------------------------------------------------------
// Keyword / pattern catalogue
// ---------------------------------------------------------------------------

const DEADLINE_KEYWORDS = [
  "deadline",
  "due",
  "due date",
  "by",
  "before",
  "until",
  "no later than",
  "must be done",
  "needs to be done",
  "complete by",
  "finish by",
  "submit by",
  "deliver by",
];

const URGENCY_KEYWORDS: Array<{ pattern: RegExp; level: UrgencyLevel; trigger: string }> = [
  { pattern: /\basap\b/i, level: "critical", trigger: "asap" },
  { pattern: /\bimmediately\b/i, level: "critical", trigger: "immediately" },
  { pattern: /\bright\s+now\b/i, level: "critical", trigger: "right now" },
  { pattern: /\burgent(ly)?\b/i, level: "high", trigger: "urgent" },
  { pattern: /\bcritical\b/i, level: "critical", trigger: "critical" },
  { pattern: /\boverdue\b/i, level: "critical", trigger: "overdue" },
  { pattern: /\bas\s+soon\s+as\s+possible\b/i, level: "critical", trigger: "as soon as possible" },
  { pattern: /\bhigh\s+priority\b/i, level: "high", trigger: "high priority" },
  { pattern: /\btime[\s-]sensitive\b/i, level: "high", trigger: "time-sensitive" },
  { pattern: /\btoday\b/i, level: "high", trigger: "today" },
  { pattern: /\btomorrow\b/i, level: "normal", trigger: "tomorrow" },
  { pattern: /\bthis\s+week\b/i, level: "normal", trigger: "this week" },
  { pattern: /\bsoon\b/i, level: "normal", trigger: "soon" },
  { pattern: /\breminder\b/i, level: "low", trigger: "reminder" },
  { pattern: /\beventually\b/i, level: "low", trigger: "eventually" },
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Detects urgency and deadline signals in text.
 *
 * @example
 * const detector = new UrgencyDetector();
 * const signals = detector.detect("Submit the report by tomorrow at 5pm — it's urgent!");
 */
export class UrgencyDetector {
  private readonly ref: Date;
  private readonly criticalMs: number;
  private readonly highMs: number;
  private readonly normalMs: number;

  constructor(config: UrgencyDetectorConfig = {}) {
    this.ref = config.referenceDate ?? new Date();
    this.criticalMs = config.thresholds?.criticalMs ?? 3_600_000; // 1 h
    this.highMs = config.thresholds?.highMs ?? 86_400_000; // 24 h
    this.normalMs = config.thresholds?.normalMs ?? 3 * 86_400_000; // 72 h
  }

  /** Return the reference date this detector uses. */
  get referenceDate(): Date {
    return new Date(this.ref);
  }

  /**
   * Scan `text` for urgency and deadline signals.
   * Returns one signal per detected marker; signals are sorted by urgency
   * level (critical first).
   */
  detect(text: string): UrgencySignal[] {
    const signals: UrgencySignal[] = [];

    // 1. Keyword-based urgency (no time expression required)
    for (const { pattern, level, trigger } of URGENCY_KEYWORDS) {
      if (pattern.test(text)) {
        signals.push({ raw: text, level, trigger });
      }
    }

    // 2. Deadline keywords followed (or preceded) by a time expression
    const parser = new TimeParser({ referenceDate: this.ref });
    const timeExtractions = parser.extractAll(text);

    const lowerText = text.toLowerCase();
    for (const kw of DEADLINE_KEYWORDS) {
      if (!lowerText.includes(kw)) continue;

      // Associate each deadline keyword with the nearest parsed time expression
      for (const { match, parsed } of timeExtractions) {
        if (parsed.kind === "unrecognized") continue;

        const deadline =
          parsed.kind === "absolute" || parsed.kind === "relative"
            ? parsed.date
            : parsed.candidates[0];

        const timeRemainingMs = deadline.getTime() - this.ref.getTime();
        const level = this._levelFromRemaining(timeRemainingMs);

        signals.push({
          raw: match,
          deadline,
          timeRemainingMs,
          level,
          trigger: kw,
        });
      }
    }

    // Deduplicate by raw text + trigger
    const seen = new Set<string>();
    const deduped: UrgencySignal[] = [];
    for (const s of signals) {
      const key = `${s.raw}:${s.trigger}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(s);
      }
    }

    return deduped.sort((a, b) => this._levelRank(a.level) - this._levelRank(b.level));
  }

  /**
   * Return the highest urgency level found across multiple signals.
   */
  highestLevel(signals: UrgencySignal[]): UrgencyLevel {
    if (signals.length === 0) return "low";
    return signals.reduce<UrgencySignal>(
      (best, s) => (this._levelRank(s.level) < this._levelRank(best.level) ? s : best),
      signals[0]
    ).level;
  }

  /**
   * Classify a time-remaining value (in ms) to an urgency level.
   * Negative values (overdue) are always "critical".
   */
  levelFromTimeRemaining(timeRemainingMs: number): UrgencyLevel {
    return this._levelFromRemaining(timeRemainingMs);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _levelFromRemaining(ms: number): UrgencyLevel {
    if (ms <= 0) return "critical"; // overdue
    if (ms <= this.criticalMs) return "critical";
    if (ms <= this.highMs) return "high";
    if (ms <= this.normalMs) return "normal";
    return "low";
  }

  /** Lower rank = higher urgency. */
  private _levelRank(level: UrgencyLevel): number {
    switch (level) {
      case "critical":
        return 0;
      case "high":
        return 1;
      case "normal":
        return 2;
      case "low":
        return 3;
    }
  }
}
