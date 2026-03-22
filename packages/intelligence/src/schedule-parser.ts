/**
 * Schedule Parser — V2-12.
 * Extracts scheduling intent (time, recurrence, action) from natural language
 * text such as "remind me tomorrow at 9am to call Alice every week".
 */

import { TimeParser } from "./time-parser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Recurrence pattern for a scheduled item. */
export type RecurrenceRule =
  | { kind: "once" }
  | { kind: "daily"; intervalDays: number }
  | { kind: "weekly"; intervalWeeks: number; dayOfWeek?: number }
  | { kind: "monthly"; dayOfMonth: number }
  | { kind: "cron"; expression: string };

export interface ParsedSchedule {
  /** The resolved trigger time (first occurrence). */
  triggerAt: Date;
  /** Recurrence rule (defaults to "once"). */
  recurrence: RecurrenceRule;
  /** The action/message the user wants to be reminded about. */
  action: string;
  /** Raw text that was parsed. */
  raw: string;
  /** Confidence in [0, 1]. Higher = more signals matched. */
  confidence: number;
}

export interface ScheduleParserConfig {
  /** Reference clock override (useful in tests). */
  referenceDate?: Date;
  /** User UTC offset in minutes for local-time interpretation. */
  userUtcOffsetMinutes?: number;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const INTENT_RE =
  /\b(remind\s+me|schedule|set\s+(?:a\s+)?reminder|alert\s+me|notify\s+me)\b/i;

const RECURRENCE_PATTERNS: Array<{
  re: RegExp;
  rule: () => RecurrenceRule;
}> = [
  {
    re: /\bevery\s+day\b/i,
    rule: () => ({ kind: "daily", intervalDays: 1 }),
  },
  {
    re: /\bevery\s+(\d+)\s+days?\b/i,
    rule: () => ({ kind: "daily", intervalDays: 1 }), // overridden after match
  },
  {
    re: /\bdaily\b/i,
    rule: () => ({ kind: "daily", intervalDays: 1 }),
  },
  {
    re: /\bevery\s+week\b/i,
    rule: () => ({ kind: "weekly", intervalWeeks: 1 }),
  },
  {
    re: /\bweekly\b/i,
    rule: () => ({ kind: "weekly", intervalWeeks: 1 }),
  },
  {
    re: /\bevery\s+(\d+)\s+weeks?\b/i,
    rule: () => ({ kind: "weekly", intervalWeeks: 1 }), // overridden after match
  },
  {
    re: /\bevery\s+month\b/i,
    rule: () => ({ kind: "monthly", dayOfMonth: 1 }),
  },
  {
    re: /\bmonthly\b/i,
    rule: () => ({ kind: "monthly", dayOfMonth: 1 }),
  },
];

const ACTION_STRIP_RE =
  /\b(remind\s+me|schedule|set\s+(?:a\s+)?reminder|alert\s+me|notify\s+me)\b/gi;

const TIME_STRIP_PATTERNS = [
  /\b(in\s+\d+\s+\w+|tomorrow|today|tonight|next\s+\w+|last\s+\w+|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/gi,
  /\b(every\s+day|every\s+\d+\s+days?|daily|every\s+week|weekly|every\s+\d+\s+weeks?|every\s+month|monthly)\b/gi,
  /\bto\b/i,
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Parses natural language schedule requests.
 *
 * @example
 * const parser = new ScheduleParser({ referenceDate: new Date("2024-01-01T08:00:00Z") });
 * const result = parser.parse("remind me tomorrow at 9am to call Alice");
 * // { triggerAt: Date<2024-01-02T09:00:00Z>, recurrence: { kind: "once" }, action: "call Alice", ... }
 */
export class ScheduleParser {
  private readonly timeParser: TimeParser;
  private readonly ref: Date;

  constructor(config: ScheduleParserConfig = {}) {
    this.ref = config.referenceDate ?? new Date();
    this.timeParser = new TimeParser({
      referenceDate: this.ref,
      userUtcOffsetMinutes: config.userUtcOffsetMinutes,
    });
  }

  /**
   * Attempt to parse a natural-language scheduling request.
   * Returns null if no scheduling intent is detected.
   */
  parse(text: string): ParsedSchedule | null {
    const hasIntent = INTENT_RE.test(text);

    // Without an explicit intent keyword, do not treat the text as a schedule.
    if (!hasIntent) return null;

    // Extract time expressions
    const timeExtractions = this.timeParser.extractAll(text);
    const validTime = timeExtractions.find(
      (e) => e.parsed.kind === "absolute" || e.parsed.kind === "relative"
    );

    // Determine trigger time
    let triggerAt: Date = this.ref;
    if (validTime) {
      const p = validTime.parsed;
      triggerAt = p.kind === "absolute" || p.kind === "relative" ? p.date : this.ref;
    }

    // Determine recurrence
    const recurrence = this._parseRecurrence(text);

    // Derive the action description by removing intent + time words
    const action = this._extractAction(text, timeExtractions.map((e) => e.match));

    // Confidence: penalise if we have no intent keyword or no time expression
    let confidence = 1.0;
    if (!hasIntent) confidence -= 0.3;
    if (!validTime) confidence -= 0.3;
    confidence = Math.max(0, confidence);

    return {
      triggerAt,
      recurrence,
      action,
      raw: text,
      confidence,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _parseRecurrence(text: string): RecurrenceRule {
    // Check every-N-days / every-N-weeks patterns first (capture group needed)
    const everyNDays = text.match(/\bevery\s+(\d+)\s+days?\b/i);
    if (everyNDays) {
      return { kind: "daily", intervalDays: parseInt(everyNDays[1], 10) };
    }

    const everyNWeeks = text.match(/\bevery\s+(\d+)\s+weeks?\b/i);
    if (everyNWeeks) {
      return { kind: "weekly", intervalWeeks: parseInt(everyNWeeks[1], 10) };
    }

    for (const { re, rule } of RECURRENCE_PATTERNS) {
      if (re.test(text)) return rule();
    }

    return { kind: "once" };
  }

  private _extractAction(text: string, timeMatches: string[]): string {
    let action = text;

    // Remove intent keywords
    action = action.replace(ACTION_STRIP_RE, "");

    // Remove matched time expressions
    for (const match of timeMatches) {
      action = action.replace(match, "");
    }

    // Remove recurrence phrases
    action = action.replace(
      /\b(every\s+\d+\s+days?|every\s+day|daily|every\s+\d+\s+weeks?|every\s+week|weekly|every\s+month|monthly)\b/gi,
      ""
    );

    // Strip leading "to"
    action = action.replace(/^\s*to\s+/i, "");

    // Collapse whitespace
    action = action.replace(/\s+/g, " ").trim();

    // Fall back to raw text if nothing meaningful remains
    return action || text.trim();
  }
}
