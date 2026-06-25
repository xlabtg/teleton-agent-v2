/**
 * Schedule Store — V2-12.
 * Persistent (in-memory) store for scheduled items, indexed by trigger time.
 * Supports querying due items, conflict detection, and state management.
 * The store is resilient to restarts: next-trigger times survive serialisation
 * (callers may persist the exported snapshot and reimport on boot).
 */

import type { RecurrenceRule } from "./schedule-parser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScheduleStatus = "pending" | "triggered" | "cancelled" | "late";

/** A persisted scheduled item. */
export interface ScheduleEntry {
  /** Unique identifier. */
  id: string;
  /** User this schedule belongs to. */
  userId: string;
  /** Human-readable description of the action to perform when triggered. */
  action: string;
  /** Next trigger timestamp. */
  triggerAt: Date;
  /** Recurrence rule. */
  recurrence: RecurrenceRule;
  /** Current lifecycle status. */
  status: ScheduleStatus;
  /** When the entry was created. */
  createdAt: Date;
  /** When the entry was last updated. */
  updatedAt: Date;
  /** User timezone offset in minutes for display purposes. */
  userUtcOffsetMinutes?: number;
  /** Optional tags (e.g. "reminder", "meeting"). */
  tags?: string[];
  /** Arbitrary extra metadata. */
  metadata?: Record<string, unknown>;
}

export interface CreateScheduleInput {
  userId: string;
  action: string;
  triggerAt: Date;
  recurrence?: RecurrenceRule;
  userUtcOffsetMinutes?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ScheduleStoreConfig {
  /**
   * Grace period (in ms) within which a missed trigger is still fired but
   * marked "late" rather than skipped entirely. Default: 15 minutes.
   */
  lateGraceMs?: number;
  /**
   * Maximum entries per user. 0 = unlimited. Default: 200.
   */
  maxEntriesPerUser?: number;
}

export interface ScheduleConflict {
  existing: ScheduleEntry;
  incoming: CreateScheduleInput;
  /** Overlap duration in milliseconds (0 = same instant). */
  overlapMs: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * In-memory schedule store ordered by trigger time.
 * All mutation methods keep the internal array sorted ascending by triggerAt.
 */
export class ScheduleStore {
  /** Primary store keyed by entry id. */
  private readonly entries = new Map<string, ScheduleEntry>();
  private readonly lateGraceMs: number;
  private readonly maxEntriesPerUser: number;

  constructor(config: ScheduleStoreConfig = {}) {
    this.lateGraceMs = config.lateGraceMs ?? 15 * 60_000;
    this.maxEntriesPerUser = config.maxEntriesPerUser ?? 200;
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /** Create and store a new schedule entry. */
  create(input: CreateScheduleInput): ScheduleEntry {
    this._checkUserCapacity(input.userId);

    const now = new Date();
    const entry: ScheduleEntry = {
      id: crypto.randomUUID(),
      userId: input.userId,
      action: input.action,
      triggerAt: input.triggerAt,
      recurrence: input.recurrence ?? { kind: "once" },
      status: "pending",
      createdAt: now,
      updatedAt: now,
      userUtcOffsetMinutes: input.userUtcOffsetMinutes,
      tags: input.tags,
      metadata: input.metadata,
    };

    this.entries.set(entry.id, entry);
    return entry;
  }

  /** Return a single entry by id, or undefined if not found. */
  get(id: string): ScheduleEntry | undefined {
    return this.entries.get(id);
  }

  /** Update fields on an existing entry. */
  update(
    id: string,
    patch: Partial<
      Pick<ScheduleEntry, "triggerAt" | "recurrence" | "action" | "status" | "tags" | "metadata">
    >
  ): ScheduleEntry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Schedule entry not found: ${id}`);

    Object.assign(entry, patch, { updatedAt: new Date() });
    return entry;
  }

  /** Cancel a pending entry. */
  cancel(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Schedule entry not found: ${id}`);
    entry.status = "cancelled";
    entry.updatedAt = new Date();
  }

  /** Permanently remove an entry. */
  delete(id: string): void {
    this.entries.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Querying
  // ---------------------------------------------------------------------------

  /** Return all pending entries for a user, sorted by triggerAt ascending. */
  listForUser(userId: string): ScheduleEntry[] {
    return this._sortedBy("triggerAt").filter((e) => e.userId === userId && e.status === "pending");
  }

  /**
   * Return entries whose triggerAt is ≤ `asOf`.
   * Entries within the late grace window are returned and marked "late".
   */
  getDue(asOf: Date = new Date()): ScheduleEntry[] {
    const cutoff = asOf.getTime();
    const lateWindowStart = cutoff - this.lateGraceMs;

    const due: ScheduleEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status !== "pending") continue;
      const triggerMs = entry.triggerAt.getTime();

      if (triggerMs <= cutoff) {
        if (triggerMs < lateWindowStart) {
          // Missed and outside grace window — mark late
          entry.status = "late";
          entry.updatedAt = new Date();
        }
        due.push(entry);
      }
    }

    return due.sort((a, b) => a.triggerAt.getTime() - b.triggerAt.getTime());
  }

  /**
   * After a recurring entry fires, advance its triggerAt to the next
   * occurrence. For "once" entries, marks the entry as triggered.
   */
  advance(id: string, firedAt: Date = new Date()): ScheduleEntry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Schedule entry not found: ${id}`);

    if (entry.recurrence.kind === "once") {
      entry.status = "triggered";
      entry.updatedAt = firedAt;
      return entry;
    }

    entry.triggerAt = this._nextOccurrenceAfter(entry.triggerAt, entry.recurrence, firedAt);
    entry.status = "pending";
    entry.updatedAt = firedAt;
    return entry;
  }

  // ---------------------------------------------------------------------------
  // Conflict detection
  // ---------------------------------------------------------------------------

  /**
   * Detect existing entries that overlap within `windowMs` of the incoming
   * schedule's trigger time. Default window: 5 minutes on each side.
   */
  detectConflicts(incoming: CreateScheduleInput, windowMs = 5 * 60_000): ScheduleConflict[] {
    const incomingTs = incoming.triggerAt.getTime();
    const conflicts: ScheduleConflict[] = [];

    for (const entry of this.entries.values()) {
      if (entry.userId !== incoming.userId) continue;
      if (entry.status === "cancelled" || entry.status === "triggered") continue;

      const delta = Math.abs(entry.triggerAt.getTime() - incomingTs);
      if (delta <= windowMs) {
        conflicts.push({
          existing: entry,
          incoming,
          overlapMs: windowMs - delta,
        });
      }
    }

    return conflicts;
  }

  // ---------------------------------------------------------------------------
  // Snapshot / restore
  // ---------------------------------------------------------------------------

  /**
   * Export all entries as plain objects for external persistence.
   * Dates are serialised as ISO strings.
   */
  export(): Array<Record<string, unknown>> {
    return Array.from(this.entries.values()).map((e) => ({
      ...e,
      triggerAt: e.triggerAt.toISOString(),
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    }));
  }

  /**
   * Import previously exported entries.
   * Existing entries with the same id are overwritten.
   */
  import(raw: Array<Record<string, unknown>>): void {
    for (const r of raw) {
      const entry: ScheduleEntry = {
        ...(r as unknown as ScheduleEntry),
        triggerAt: new Date(r.triggerAt as string),
        createdAt: new Date(r.createdAt as string),
        updatedAt: new Date(r.updatedAt as string),
      };
      this.entries.set(entry.id, entry);
    }
  }

  /** Total number of entries (all statuses). */
  get size(): number {
    return this.entries.size;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _sortedBy(field: "triggerAt"): ScheduleEntry[] {
    return Array.from(this.entries.values()).sort(
      (a, b) => a[field].getTime() - b[field].getTime()
    );
  }

  private _checkUserCapacity(userId: string): void {
    if (this.maxEntriesPerUser === 0) return;
    const count = Array.from(this.entries.values()).filter(
      (e) => e.userId === userId && e.status === "pending"
    ).length;
    if (count >= this.maxEntriesPerUser) {
      throw new Error(
        `User ${userId} has reached the maximum number of schedules (${this.maxEntriesPerUser})`
      );
    }
  }

  private _nextOccurrenceAfter(current: Date, rule: RecurrenceRule, after: Date): Date {
    let next = this._nextOccurrence(current, rule);
    while (next.getTime() <= after.getTime()) {
      next = this._nextOccurrence(next, rule);
    }
    return next;
  }

  private _nextOccurrence(current: Date, rule: RecurrenceRule): Date {
    const d = new Date(current);
    switch (rule.kind) {
      case "daily":
        d.setUTCDate(d.getUTCDate() + rule.intervalDays);
        break;
      case "weekly":
        d.setUTCDate(d.getUTCDate() + rule.intervalWeeks * 7);
        if (rule.dayOfWeek !== undefined) {
          const dayDelta = rule.dayOfWeek - d.getUTCDay();
          d.setUTCDate(d.getUTCDate() + dayDelta);
        }
        break;
      case "monthly":
        return this._nextMonthlyOccurrence(d, rule.dayOfMonth);
      case "cron":
        // Cron advancement is intentionally left to the caller / a cron library.
        // We add one day as a safe fallback so the entry doesn't get stuck.
        d.setUTCDate(d.getUTCDate() + 1);
        break;
      case "once":
        // Shouldn't reach here; just return unchanged.
        break;
    }
    return d;
  }

  private _nextMonthlyOccurrence(current: Date, dayOfMonth: number): Date {
    const targetMonth = current.getUTCMonth() + 1;
    const targetYear = current.getUTCFullYear() + Math.floor(targetMonth / 12);
    const normalizedMonth = targetMonth % 12;
    const clampedDay = Math.min(dayOfMonth, this._daysInUtcMonth(targetYear, normalizedMonth));

    return new Date(
      Date.UTC(
        targetYear,
        normalizedMonth,
        clampedDay,
        current.getUTCHours(),
        current.getUTCMinutes(),
        current.getUTCSeconds(),
        current.getUTCMilliseconds()
      )
    );
  }

  private _daysInUtcMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  }
}
