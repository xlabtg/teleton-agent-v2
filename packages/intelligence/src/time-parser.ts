/**
 * Time Parser — V2-11.
 * Resolves relative and absolute temporal expressions to concrete Date objects.
 * Handles common natural language patterns without an external NLP dependency.
 * Date objects are returned as UTC instants. Absolute wall-clock expressions are
 * interpreted in the caller's configured UTC offset before conversion to UTC.
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

function toUserWallClock(d: Date, userUtcOffsetMinutes: number): Date {
  return new Date(d.getTime() + userUtcOffsetMinutes * 60_000);
}

function fromUserWallClock(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  userUtcOffsetMinutes: number
): Date {
  return new Date(Date.UTC(year, month, day, hours, minutes, 0, 0) - userUtcOffsetMinutes * 60_000);
}

function isValidWallClockDate(year: number, month: number, day: number): boolean {
  const candidate = new Date(Date.UTC(year, month, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month &&
    candidate.getUTCDate() === day
  );
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addCalendarUnits(
  d: Date,
  unit: "month" | "year",
  amount: number,
  userUtcOffsetMinutes: number
): Date {
  const wallClock = toUserWallClock(d, userUtcOffsetMinutes);
  const sourceDay = wallClock.getUTCDate();
  let targetYear = wallClock.getUTCFullYear();
  let targetMonth = wallClock.getUTCMonth();

  if (unit === "month") {
    targetMonth += amount;
    targetYear += Math.floor(targetMonth / 12);
    targetMonth %= 12;
    if (targetMonth < 0) {
      targetMonth += 12;
      targetYear -= 1;
    }
  } else {
    targetYear += amount;
  }

  const targetDay = Math.min(sourceDay, daysInUtcMonth(targetYear, targetMonth));
  return fromUserWallClock(
    targetYear,
    targetMonth,
    targetDay,
    wallClock.getUTCHours(),
    wallClock.getUTCMinutes(),
    userUtcOffsetMinutes
  );
}

function startOfDay(d: Date, userUtcOffsetMinutes: number): Date {
  const wallClock = toUserWallClock(d, userUtcOffsetMinutes);
  return fromUserWallClock(
    wallClock.getUTCFullYear(),
    wallClock.getUTCMonth(),
    wallClock.getUTCDate(),
    0,
    0,
    userUtcOffsetMinutes
  );
}

function applyTimeOfDay(base: Date, expr: string, userUtcOffsetMinutes: number): Date {
  const m = expr.match(TIME_OF_DAY_RE);
  if (!m) return base;
  let hours = parseInt(m[1], 10);
  const minutes = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  const wallClock = toUserWallClock(base, userUtcOffsetMinutes);
  return fromUserWallClock(
    wallClock.getUTCFullYear(),
    wallClock.getUTCMonth(),
    wallClock.getUTCDate(),
    hours,
    minutes,
    userUtcOffsetMinutes
  );
}

function prevWeekday(from: Date, targetDay: number, userUtcOffsetMinutes: number): Date {
  const d = toUserWallClock(from, userUtcOffsetMinutes);
  const diff = (d.getUTCDay() - targetDay + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return fromUserWallClock(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    0,
    0,
    userUtcOffsetMinutes
  );
}

function resolveUpcomingWeekday(
  from: Date,
  targetDay: number,
  expr: string,
  userUtcOffsetMinutes: number
): Date {
  const wallClock = toUserWallClock(from, userUtcOffsetMinutes);
  const diff = (targetDay - wallClock.getUTCDay() + 7) % 7;
  wallClock.setUTCDate(wallClock.getUTCDate() + diff);

  const candidate = applyTimeOfDay(
    fromUserWallClock(
      wallClock.getUTCFullYear(),
      wallClock.getUTCMonth(),
      wallClock.getUTCDate(),
      0,
      0,
      userUtcOffsetMinutes
    ),
    expr,
    userUtcOffsetMinutes
  );

  if (candidate.getTime() <= from.getTime()) {
    const next = new Date(candidate);
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }

  return candidate;
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
  private readonly userUtcOffsetMinutes: number;

  constructor(config: TimeParserConfig = {}) {
    this.ref = config.referenceDate ?? new Date();
    this.userUtcOffsetMinutes = config.userUtcOffsetMinutes ?? 0;
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
      const unit = inMatch[2].toLowerCase() as keyof typeof UNIT_MS | "month" | "year";
      const baseDate =
        unit === "month" || unit === "year"
          ? addCalendarUnits(this.ref, unit, n, this.userUtcOffsetMinutes)
          : new Date(this.ref.getTime() + n * UNIT_MS[unit]);
      const date = applyTimeOfDay(baseDate, normalised, this.userUtcOffsetMinutes);
      return {
        kind: "relative",
        date,
        raw: normalised,
        offsetMs: date.getTime() - this.ref.getTime(),
      };
    }

    // 2. "N unit(s) ago"
    const agoMatch = normalised.match(AGO_UNIT_RE);
    if (agoMatch) {
      const n = parseInt(agoMatch[1], 10);
      const unit = agoMatch[2].toLowerCase() as keyof typeof UNIT_MS | "month" | "year";
      const date =
        unit === "month" || unit === "year"
          ? addCalendarUnits(this.ref, unit, -n, this.userUtcOffsetMinutes)
          : new Date(this.ref.getTime() - n * UNIT_MS[unit]);
      return {
        kind: "relative",
        date,
        raw: normalised,
        offsetMs: date.getTime() - this.ref.getTime(),
      };
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
        date = prevWeekday(this.ref, day, this.userUtcOffsetMinutes);
        date = applyTimeOfDay(date, normalised, this.userUtcOffsetMinutes);
      } else {
        // "next" or bare weekday → upcoming occurrence
        date = resolveUpcomingWeekday(this.ref, day, normalised, this.userUtcOffsetMinutes);
      }
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
      const [year, month, day] = isoMatch[1]
        .replace(/\//g, "-")
        .split("-")
        .map((part) => parseInt(part, 10));
      const date = applyTimeOfDay(
        fromUserWallClock(year, month - 1, day, 0, 0, this.userUtcOffsetMinutes),
        normalised,
        this.userUtcOffsetMinutes
      );
      return { kind: "absolute", date, raw: normalised };
    }

    // 6. Month-name dates: "March 15", "March 15, 2024"
    const monthMatch = normalised.match(MONTH_NAME_RE);
    if (monthMatch) {
      const month = MONTH_INDEX[monthMatch[1].toLowerCase()];
      const day = parseInt(monthMatch[2], 10);
      const referenceWallClock = toUserWallClock(this.ref, this.userUtcOffsetMinutes);
      const year = monthMatch[3]
        ? parseInt(monthMatch[3], 10)
        : referenceWallClock.getUTCFullYear();
      const date = applyTimeOfDay(
        fromUserWallClock(year, month, day, 0, 0, this.userUtcOffsetMinutes),
        normalised,
        this.userUtcOffsetMinutes
      );
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
      const valid1 = isValidWallClockDate(y, a - 1, b);
      const valid2 = isValidWallClockDate(y, b - 1, a);
      const candidate1 = fromUserWallClock(y, a - 1, b, 0, 0, this.userUtcOffsetMinutes);
      const candidate2 = fromUserWallClock(y, b - 1, a, 0, 0, this.userUtcOffsetMinutes);
      if (valid1 && valid2 && a !== b) {
        return {
          kind: "ambiguous",
          candidates: [candidate1, candidate2],
          raw: normalised,
          needsClarification: true,
        };
      }
      if (valid1)
        return {
          kind: "absolute",
          date: applyTimeOfDay(candidate1, normalised, this.userUtcOffsetMinutes),
          raw: normalised,
        };
      if (valid2)
        return {
          kind: "absolute",
          date: applyTimeOfDay(candidate2, normalised, this.userUtcOffsetMinutes),
          raw: normalised,
        };
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
    const today = startOfDay(this.ref, this.userUtcOffsetMinutes);

    switch (term) {
      case "now":
        return new Date(this.ref);
      case "today":
        return applyTimeOfDay(today, full, this.userUtcOffsetMinutes);
      case "tomorrow": {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() + 1);
        return applyTimeOfDay(d, full, this.userUtcOffsetMinutes);
      }
      case "yesterday": {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - 1);
        return applyTimeOfDay(d, full, this.userUtcOffsetMinutes);
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
        return addCalendarUnits(today, "month", 1, this.userUtcOffsetMinutes);
      }
      case "last month": {
        return addCalendarUnits(today, "month", -1, this.userUtcOffsetMinutes);
      }
      case "next year": {
        return addCalendarUnits(today, "year", 1, this.userUtcOffsetMinutes);
      }
      case "last year": {
        return addCalendarUnits(today, "year", -1, this.userUtcOffsetMinutes);
      }
      default:
        return null;
    }
  }
}
