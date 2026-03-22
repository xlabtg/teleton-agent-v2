/**
 * Time Parser — V2-11.
 * Resolves relative and absolute temporal expressions to concrete Date objects.
 * Handles common natural language patterns without an external NLP dependency.
 * All internal calculations are performed in UTC; caller may supply a timezone
 * offset for user-facing display.
 */

export type ParsedTime =
  | { kind: "absolute"; date: Date; raw: string }
  | { kind: "relative"; date: Date; raw: string; offsetMs: number }
  | { kind: "ambiguous"; candidates: Date[]; raw: string; needsClarification: true }
  | { kind: "unrecognized"; raw: string };

export interface TimeParserConfig {
  /** Reference "now" to use instead of the real clock. Useful in tests. */
  referenceDate?: Date;
  /**
   * User's UTC offset in minutes, e.g. +60 for UTC+1.
   * Defaults to 0 (UTC).
   */
  userUtcOffsetMinutes?: number;
}

// ---------------------------------------------------------------------------
// Regex catalogue
// ---------------------------------------------------------------------------

const RELATIVE_UNIT_RE = /\bin\s+(\d+)\s+(second|minute|hour|day|week|month|year)s?\b/i;

const AGO_UNIT_RE = /\b(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/i;

const NAMED_RELATIVE_RE =
  /\b(now|today|tomorrow|yesterday|next\s+week|last\s+week|next\s+month|last\s+month|next\s+year|last\s+year)\b/i;

const TIME_OF_DAY_RE = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

const WEEKDAY_RE = /\b(next|last)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

const ISO_DATE_RE = /\b(\d{4}[-/]\d{2}[-/]\d{2})\b/;

const COMPACT_DATE_RE = /\b(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/;

const MONTH_NAME_RE =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000,
};

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function applyTimeOfDay(base: Date, expr: string): Date {
  const m = expr.match(TIME_OF_DAY_RE);
  if (!m) return base;
  let hours = parseInt(m[1], 10);
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  const result = new Date(base);
  result.setUTCHours(hours, minutes, 0, 0);
  return result;
}

function nextWeekday(from: Date, targetDay: number): Date {
  const d = new Date(from);
  const diff = (targetDay - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + diff);
  return startOfDay(d);
}

function prevWeekday(from: Date, targetDay: number): Date {
  const d = new Date(from);
  const diff = (d.getUTCDay() - targetDay + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return startOfDay(d);
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

/**
 * Parses natural language time expressions into typed ParsedTime results.
 *
 * @example
 * const parser = new TimeParser();
 * const result = parser.parse("in 2 hours");
 * // { kind: "relative", date: Date<now+2h>, offsetMs: 7200000, raw: "in 2 hours" }
 */
export class TimeParser {
  private readonly ref: Date;

  constructor(config: TimeParserConfig = {}) {
    this.ref = config.referenceDate ?? new Date();
  }

  /** Return the reference "now" this parser uses. */
  get referenceDate(): Date {
    return new Date(this.ref);
  }

  /**
   * Parse a text fragment and return a typed ParsedTime.
   * Tries multiple patterns in order; returns the first match.
   */
  parse(text: string): ParsedTime {
    const normalised = text.trim();

    // 1. "in N unit(s)"
    const inMatch = normalised.match(RELATIVE_UNIT_RE);
    if (inMatch) {
      const n = parseInt(inMatch[1], 10);
      const unit = inMatch[2].toLowerCase();
      const offsetMs = n * UNIT_MS[unit];
      const date = applyTimeOfDay(new Date(this.ref.getTime() + offsetMs), normalised);
      return { kind: "relative", date, raw: normalised, offsetMs };
    }

    // 2. "N unit(s) ago"
    const agoMatch = normalised.match(AGO_UNIT_RE);
    if (agoMatch) {
      const n = parseInt(agoMatch[1], 10);
      const unit = agoMatch[2].toLowerCase();
      const offsetMs = -(n * UNIT_MS[unit]);
      const date = new Date(this.ref.getTime() + offsetMs);
      return { kind: "relative", date, raw: normalised, offsetMs };
    }

    // 3. Named relative terms
    const namedMatch = normalised.match(NAMED_RELATIVE_RE);
    if (namedMatch) {
      const term = namedMatch[1].toLowerCase().replace(/\s+/g, " ");
      const date = this._resolveNamed(term, normalised);
      if (date) {
        return {
          kind: "relative",
          date,
          raw: normalised,
          offsetMs: date.getTime() - this.ref.getTime(),
        };
      }
    }

    // 4. Weekday references ("next monday", "last friday", "tuesday")
    const weekdayMatch = normalised.match(WEEKDAY_RE);
    if (weekdayMatch) {
      const modifier = weekdayMatch[1]?.toLowerCase();
      const day = WEEKDAY_INDEX[weekdayMatch[2].toLowerCase()];
      let date: Date;
      if (modifier === "last") {
        date = prevWeekday(this.ref, day);
      } else {
        // "next" or bare weekday → upcoming occurrence
        date = nextWeekday(this.ref, day);
      }
      date = applyTimeOfDay(date, normalised);
      return {
        kind: "relative",
        date,
        raw: normalised,
        offsetMs: date.getTime() - this.ref.getTime(),
      };
    }

    // 5. ISO / compact dates
    const isoMatch = normalised.match(ISO_DATE_RE);
    if (isoMatch) {
      const date = applyTimeOfDay(
        new Date(isoMatch[1].replace(/\//g, "-") + "T00:00:00Z"),
        normalised
      );
      return { kind: "absolute", date, raw: normalised };
    }

    // 6. Month-name dates: "March 15", "March 15, 2024"
    const monthMatch = normalised.match(MONTH_NAME_RE);
    if (monthMatch) {
      const month = MONTH_INDEX[monthMatch[1].toLowerCase()];
      const day = parseInt(monthMatch[2], 10);
      const year = monthMatch[3] ? parseInt(monthMatch[3], 10) : this.ref.getUTCFullYear();
      const date = applyTimeOfDay(new Date(Date.UTC(year, month, day)), normalised);
      return { kind: "absolute", date, raw: normalised };
    }

    // 7. Compact dates: "15/03/2024" or "3.15.24"
    const compactMatch = normalised.match(COMPACT_DATE_RE);
    if (compactMatch) {
      const a = parseInt(compactMatch[1], 10);
      const b = parseInt(compactMatch[2], 10);
      let y = parseInt(compactMatch[3], 10);
      if (y < 100) y += 2000;
      // Ambiguous: could be MM/DD or DD/MM
      const candidate1 = new Date(Date.UTC(y, a - 1, b));
      const candidate2 = new Date(Date.UTC(y, b - 1, a));
      const valid1 = !isNaN(candidate1.getTime()) && candidate1.getUTCMonth() === a - 1;
      const valid2 = !isNaN(candidate2.getTime()) && candidate2.getUTCMonth() === b - 1;
      if (valid1 && valid2 && a !== b) {
        return {
          kind: "ambiguous",
          candidates: [candidate1, candidate2],
          raw: normalised,
          needsClarification: true,
        };
      }
      if (valid1)
        return { kind: "absolute", date: applyTimeOfDay(candidate1, normalised), raw: normalised };
      if (valid2)
        return { kind: "absolute", date: applyTimeOfDay(candidate2, normalised), raw: normalised };
    }

    return { kind: "unrecognized", raw: normalised };
  }

  /**
   * Extract and parse all time expressions found within a longer text.
   * Returns an array of { match, parsed } objects, one per expression found.
   */
  extractAll(text: string): Array<{ match: string; parsed: ParsedTime }> {
    const patterns = [
      RELATIVE_UNIT_RE,
      AGO_UNIT_RE,
      NAMED_RELATIVE_RE,
      WEEKDAY_RE,
      ISO_DATE_RE,
      MONTH_NAME_RE,
      COMPACT_DATE_RE,
    ];

    // Trailing time-of-day: " at HH[:MM][am/pm]"
    const TRAILING_TOD_RE = /\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i;

    const found: Array<{ index: number; match: string }> = [];
    for (const re of patterns) {
      const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      let m: RegExpExecArray | null;
      while ((m = global.exec(text)) !== null) {
        let match = m[0];
        const afterIdx = m.index + match.length;
        // Extend named/weekday/absolute matches to include a trailing time-of-day
        const trailing = text.slice(afterIdx).match(TRAILING_TOD_RE);
        if (trailing && trailing.index === 0) {
          match += trailing[0];
        }
        found.push({ index: m.index, match });
      }
    }

    // Deduplicate overlapping matches by keeping the longest at each position
    found.sort((a, b) => a.index - b.index || b.match.length - a.match.length);
    const deduped: Array<{ match: string }> = [];
    let lastEnd = -1;
    for (const f of found) {
      if (f.index >= lastEnd) {
        deduped.push(f);
        lastEnd = f.index + f.match.length;
      }
    }

    return deduped.map((f) => ({ match: f.match, parsed: this.parse(f.match) }));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _resolveNamed(term: string, full: string): Date | null {
    const today = startOfDay(this.ref);

    switch (term) {
      case "now":
        return new Date(this.ref);
      case "today":
        return applyTimeOfDay(today, full);
      case "tomorrow": {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() + 1);
        return applyTimeOfDay(d, full);
      }
      case "yesterday": {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - 1);
        return applyTimeOfDay(d, full);
      }
      case "next week": {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() + 7);
        return d;
      }
      case "last week": {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - 7);
        return d;
      }
      case "next month": {
        const d = new Date(today);
        d.setUTCMonth(d.getUTCMonth() + 1);
        return d;
      }
      case "last month": {
        const d = new Date(today);
        d.setUTCMonth(d.getUTCMonth() - 1);
        return d;
      }
      case "next year": {
        const d = new Date(today);
        d.setUTCFullYear(d.getUTCFullYear() + 1);
        return d;
      }
      case "last year": {
        const d = new Date(today);
        d.setUTCFullYear(d.getUTCFullYear() - 1);
        return d;
      }
      default:
        return null;
    }
  }
}
