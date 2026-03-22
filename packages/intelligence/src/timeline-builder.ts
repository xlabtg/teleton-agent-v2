/**
 * Timeline Builder — V2-11.
 * Constructs a chronologically ordered event timeline from conversation
 * messages and memory entries, supporting filtering, pagination, and
 * gap detection.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Source of a timeline event. */
export type EventSource = "conversation" | "memory" | "schedule" | "system" | string;

/** A single entry on the timeline. */
export interface TimelineEvent {
  /** Unique identifier. */
  id: string;
  /** Human-readable description of the event. */
  description: string;
  /** When the event occurred or is scheduled to occur. */
  timestamp: Date;
  /** Origin of this event. */
  source: EventSource;
  /** Optional tags for filtering (e.g. "deadline", "meeting", "reminder"). */
  tags?: string[];
  /** Arbitrary extra metadata. */
  metadata?: Record<string, unknown>;
}

export interface TimelineBuilderConfig {
  /**
   * Maximum number of events to keep in the timeline.
   * Oldest events are removed when the limit is exceeded. Default: 1000.
   */
  maxEvents?: number;
  /**
   * Minimum gap (in ms) between two consecutive events that should be
   * reported as a "gap" by detectGaps(). Default: 3600000 (1 hour).
   */
  gapThresholdMs?: number;
}

export interface TimelineGap {
  /** The event just before the gap. */
  before: TimelineEvent;
  /** The event just after the gap. */
  after: TimelineEvent;
  /** Duration of the gap in milliseconds. */
  durationMs: number;
}

export interface TimelineSlice {
  events: TimelineEvent[];
  /** Total events in the unsliced timeline (after any source/tag filters). */
  total: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Builds and queries a chronological timeline of events.
 *
 * Events may be added individually or in bulk and are always stored in
 * ascending timestamp order. Duplicate ids are replaced with the newer entry.
 */
export class TimelineBuilder {
  /** Internal store: kept sorted ascending by timestamp. */
  private events: TimelineEvent[] = [];
  private readonly maxEvents: number;
  private readonly gapThresholdMs: number;

  constructor(config: TimelineBuilderConfig = {}) {
    this.maxEvents = config.maxEvents ?? 1000;
    this.gapThresholdMs = config.gapThresholdMs ?? 3_600_000;
  }

  /** Total number of events in the timeline. */
  get size(): number {
    return this.events.length;
  }

  /**
   * Add a single event to the timeline.
   * If an event with the same id already exists it is replaced.
   */
  addEvent(event: Omit<TimelineEvent, "id"> & { id?: string }): TimelineEvent {
    const stored: TimelineEvent = {
      ...event,
      id: event.id ?? crypto.randomUUID(),
    };

    // Replace existing event with same id
    const existingIdx = this.events.findIndex((e) => e.id === stored.id);
    if (existingIdx !== -1) {
      this.events.splice(existingIdx, 1);
    }

    // Insert in sorted order
    const insertAt = this._findInsertIndex(stored.timestamp);
    this.events.splice(insertAt, 0, stored);

    // Trim oldest events if over capacity
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }

    return stored;
  }

  /** Add multiple events at once. */
  addEvents(events: Array<Omit<TimelineEvent, "id"> & { id?: string }>): TimelineEvent[] {
    return events.map((e) => this.addEvent(e));
  }

  /** Remove an event by id. No-op if not found. */
  removeEvent(id: string): void {
    const idx = this.events.findIndex((e) => e.id === id);
    if (idx !== -1) this.events.splice(idx, 1);
  }

  /**
   * Return a chronological slice of the timeline.
   *
   * @param options.source   Filter by event source.
   * @param options.tags     Filter events that contain ALL of the given tags.
   * @param options.since    Only return events at or after this date.
   * @param options.until    Only return events at or before this date.
   * @param options.offset   Pagination offset.
   * @param options.limit    Maximum number of events to return.
   */
  query(
    options: {
      source?: EventSource;
      tags?: string[];
      since?: Date;
      until?: Date;
      offset?: number;
      limit?: number;
    } = {}
  ): TimelineSlice {
    let filtered = this.events;

    if (options.source) {
      filtered = filtered.filter((e) => e.source === options.source);
    }
    if (options.tags && options.tags.length > 0) {
      filtered = filtered.filter((e) => options.tags!.every((t) => e.tags?.includes(t)));
    }
    if (options.since) {
      filtered = filtered.filter((e) => e.timestamp >= options.since!);
    }
    if (options.until) {
      filtered = filtered.filter((e) => e.timestamp <= options.until!);
    }

    const total = filtered.length;
    const offset = options.offset ?? 0;
    const limit = options.limit;
    const sliced =
      limit !== undefined ? filtered.slice(offset, offset + limit) : filtered.slice(offset);

    return { events: sliced, total };
  }

  /**
   * Detect temporal gaps larger than gapThresholdMs between consecutive events.
   * Useful for spotting missing context in a conversation or log.
   */
  detectGaps(options: { since?: Date; until?: Date } = {}): TimelineGap[] {
    const { events } = this.query(options);
    const gaps: TimelineGap[] = [];

    for (let i = 0; i < events.length - 1; i++) {
      const durationMs = events[i + 1].timestamp.getTime() - events[i].timestamp.getTime();
      if (durationMs > this.gapThresholdMs) {
        gaps.push({ before: events[i], after: events[i + 1], durationMs });
      }
    }

    return gaps;
  }

  /**
   * Return events within a rolling window ending at `until` (defaults to now).
   */
  window(durationMs: number, until: Date = new Date()): TimelineEvent[] {
    const since = new Date(until.getTime() - durationMs);
    return this.query({ since, until }).events;
  }

  /** Return all events (a defensive copy). */
  all(): TimelineEvent[] {
    return [...this.events];
  }

  /** Clear all events. */
  clear(): void {
    this.events = [];
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Binary search for the correct insertion index to maintain sort order. */
  private _findInsertIndex(timestamp: Date): number {
    const ts = timestamp.getTime();
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.events[mid].timestamp.getTime() <= ts) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
}
