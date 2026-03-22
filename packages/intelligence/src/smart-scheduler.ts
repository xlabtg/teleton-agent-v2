/**
 * Smart Scheduler — V2-12.
 * Orchestrates schedule creation from natural language, persistent storage,
 * polling for due items, and notification delivery.
 *
 * The daemon loop uses setInterval internally so callers do not need to manage
 * polling themselves. Call start() once and stop() on shutdown.
 * Missed triggers (during downtime) are recovered on the next poll and
 * delivered with isLate = true.
 */

import { ScheduleParser } from "./schedule-parser.js";
import { ScheduleStore } from "./schedule-store.js";
import type { ScheduleEntry, CreateScheduleInput } from "./schedule-store.js";
import { NotificationAdapter } from "./notification-adapter.js";
import type { NotificationPayload, NotificationChannel, ChannelHandler } from "./notification-adapter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SmartSchedulerConfig {
  /** How often (in ms) to poll for due items. Default: 60 000 (1 minute). */
  pollIntervalMs?: number;
  /**
   * Default channels to notify when an item fires, if none are specified
   * in the trigger call. Default: ["in-app"].
   */
  defaultChannels?: NotificationChannel[];
  /** Reference clock override (useful in tests). */
  referenceDate?: Date;
  /** User UTC offset in minutes for schedule parsing. */
  userUtcOffsetMinutes?: number;
}

export interface ScheduleRequest {
  userId: string;
  text: string;
  channels?: NotificationChannel[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ScheduleRequestResult {
  /** Created schedule entry, or null if parsing failed. */
  entry: ScheduleEntry | null;
  /** Confidence score from the parser. Null if not parsed. */
  confidence: number | null;
  /** Conflicts detected at creation time. */
  conflicts: Array<{ existingId: string; overlapMs: number }>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * High-level scheduler that ties together parsing, storage, and delivery.
 *
 * @example
 * const scheduler = new SmartScheduler();
 * scheduler.adapter.registerHandler("in-app", async (p) => console.log(p.entry.action));
 * await scheduler.schedule({ userId: "u1", text: "remind me tomorrow at 9am to review the PR" });
 * scheduler.start();
 */
export class SmartScheduler {
  readonly store: ScheduleStore;
  readonly adapter: NotificationAdapter;

  private readonly parser: ScheduleParser;
  private readonly pollIntervalMs: number;
  private readonly defaultChannels: NotificationChannel[];
  private refDate: Date | undefined;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: SmartSchedulerConfig = {},
    store?: ScheduleStore,
    adapter?: NotificationAdapter
  ) {
    this.pollIntervalMs = config.pollIntervalMs ?? 60_000;
    this.defaultChannels = config.defaultChannels ?? ["in-app"];
    this.refDate = config.referenceDate;

    this.store = store ?? new ScheduleStore();
    this.adapter = adapter ?? new NotificationAdapter();
    this.parser = new ScheduleParser({
      referenceDate: this.now(),
      userUtcOffsetMinutes: config.userUtcOffsetMinutes,
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Parse a natural language scheduling request and create a schedule entry.
   * Returns the entry and any detected conflicts.
   */
  async schedule(request: ScheduleRequest): Promise<ScheduleRequestResult> {
    const parsed = this.parser.parse(request.text);

    if (!parsed) {
      return { entry: null, confidence: null, conflicts: [] };
    }

    const input: CreateScheduleInput = {
      userId: request.userId,
      action: parsed.action,
      triggerAt: parsed.triggerAt,
      recurrence: parsed.recurrence,
      tags: request.tags,
      metadata: request.metadata,
    };

    const rawConflicts = this.store.detectConflicts(input);
    const entry = this.store.create(input);

    return {
      entry,
      confidence: parsed.confidence,
      conflicts: rawConflicts.map((c) => ({
        existingId: c.existing.id,
        overlapMs: c.overlapMs,
      })),
    };
  }

  /**
   * Create a schedule entry directly from structured data (bypassing NLP parsing).
   */
  createDirect(input: CreateScheduleInput): ScheduleEntry {
    return this.store.create(input);
  }

  /** Cancel a schedule entry. */
  cancel(entryId: string): void {
    this.store.cancel(entryId);
  }

  /** List pending schedules for a user. */
  listForUser(userId: string): ScheduleEntry[] {
    return this.store.listForUser(userId);
  }

  /**
   * Register a channel handler on the underlying NotificationAdapter.
   */
  registerChannel(channel: NotificationChannel, handler: ChannelHandler): void {
    this.adapter.registerHandler(channel, handler);
  }

  // ---------------------------------------------------------------------------
  // Daemon
  // ---------------------------------------------------------------------------

  /**
   * Start the polling daemon. No-op if already running.
   */
  start(): void {
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => {
      void this._tick();
    }, this.pollIntervalMs);
  }

  /**
   * Stop the polling daemon. No-op if not running.
   */
  stop(): void {
    if (this.pollTimer === null) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** Whether the daemon is currently running. */
  get isRunning(): boolean {
    return this.pollTimer !== null;
  }

  /**
   * Manually trigger a single poll cycle (useful in tests or for on-demand checks).
   */
  async tick(): Promise<void> {
    return this._tick();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _tick(): Promise<void> {
    const asOf = this.now();
    const due = this.store.getDue(asOf);

    await Promise.all(
      due.map(async (entry) => {
        const isLate = entry.status === "late";
        const payload: NotificationPayload = {
          entry,
          dispatchedAt: asOf,
          isLate,
        };

        const channels = this.defaultChannels;
        await this.adapter.dispatch(payload, channels);

        // Advance recurring or mark as triggered
        this.store.advance(entry.id, asOf);
      })
    );
  }

  private now(): Date {
    return this.refDate ?? new Date();
  }
}
