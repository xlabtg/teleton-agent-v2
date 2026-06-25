/**
 * Dead Letter Queue — V2-16.
 * Captures events whose handlers failed, supports configurable retry with
 * exponential backoff, manual replay, and event sourcing utilities.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { TypedEvent } from "./event-schema.js";

export interface DeadLetterEntry {
  /** Unique DLQ entry identifier. */
  id: string;
  /** The event that failed processing. */
  event: TypedEvent;
  /** Most recent error message from the failed handler or replay attempt. */
  errorMessage: string;
  /** Message from the most recent failed replay attempt, if any. */
  lastErrorMessage?: string;
  /** Error name from the most recent failed replay attempt, if any. */
  lastErrorName?: string;
  /** Error stack from the most recent failed replay attempt, if any. */
  lastErrorStack?: string;
  /** ISO timestamp when the entry was added to the DLQ. */
  enqueuedAt: string;
  /** ISO timestamp of the most recent retry attempt, if any. */
  lastRetryAt: string | null;
  /** Total number of retry attempts so far. */
  retryCount: number;
  /** ISO timestamp when this entry was successfully replayed, if any. */
  replayedAt: string | null;
  /** Name of the handler subscription that failed, if known. */
  handlerName?: string;
}

export type DlqReplayHandler = (event: TypedEvent) => Promise<void>;

export interface DlqReplayResult {
  ok: boolean;
  error?: Error;
}

export interface DlqReplayFailure {
  id: string;
  event: TypedEvent;
  error: Error;
}

export interface DlqRetryAllResult {
  success: number;
  failed: number;
  failures: DlqReplayFailure[];
}

export interface DeadLetterQueueConfig {
  /**
   * Maximum retry attempts before an entry is considered permanently failed.
   * Defaults to 3.
   */
  maxRetries?: number;
  /**
   * Base delay in milliseconds for exponential backoff between retries.
   * Defaults to 500.
   */
  retryBaseDelayMs?: number;
  /**
   * Cap on retry delay.
   * Defaults to 30 000 (30 s).
   */
  retryMaxDelayMs?: number;
  /**
   * Maximum number of entries to retain.
   * When the limit is reached, replayed entries are purged first.
   * If all retained entries are still pending, enqueue throws instead of
   * silently dropping recoverable failures.
   * Defaults to 500.
   */
  maxEntries?: number;
}

export class DeadLetterQueueFullError extends Error {
  constructor(maxEntries: number) {
    super(`Dead letter queue is full (${maxEntries} pending entries)`);
    this.name = "DeadLetterQueueFullError";
  }
}

// ---------------------------------------------------------------------------
// DeadLetterQueue
// ---------------------------------------------------------------------------

/**
 * Holds failed event deliveries and supports automated or manual replay.
 *
 * @example
 * const dlq = new DeadLetterQueue({ maxRetries: 5 });
 * dlq.enqueue(event, "Connection refused", "myHandler");
 * await dlq.retryAll(async (evt) => { await myHandler(evt); });
 */
export class DeadLetterQueue {
  private readonly entries: DeadLetterEntry[] = [];
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly maxEntries: number;
  private _entryCounter = 0;

  constructor(config: DeadLetterQueueConfig = {}) {
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 500;
    this.retryMaxDelayMs = config.retryMaxDelayMs ?? 30_000;
    this.maxEntries = config.maxEntries ?? 500;
  }

  /** Number of entries currently in the queue. */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Add a failed event to the queue.
   * @throws DeadLetterQueueFullError when the queue is full of pending entries.
   */
  enqueue(event: TypedEvent, errorMessage: string, handlerName?: string): DeadLetterEntry {
    if (this.entries.length >= this.maxEntries) {
      this.purgeReplayed();
    }
    if (this.entries.length >= this.maxEntries) {
      throw new DeadLetterQueueFullError(this.maxEntries);
    }

    const entry: DeadLetterEntry = {
      id: `dlq-${Date.now()}-${++this._entryCounter}`,
      event,
      errorMessage,
      enqueuedAt: new Date().toISOString(),
      lastRetryAt: null,
      retryCount: 0,
      replayedAt: null,
      ...(handlerName ? { handlerName } : {}),
    };
    this.entries.push(entry);
    return entry;
  }

  /**
   * Return a copy of all pending (not yet replayed) entries.
   */
  listPending(): DeadLetterEntry[] {
    return this.entries.filter((e) => e.replayedAt === null).slice();
  }

  /**
   * Return a copy of all permanently failed entries (exceeded maxRetries and not replayed).
   */
  listPermanentFailures(): DeadLetterEntry[] {
    return this.entries
      .filter((e) => e.replayedAt === null && e.retryCount >= this.maxRetries)
      .slice();
  }

  /**
   * Manually replay a single entry by ID using the provided handler.
   * Marks the entry as replayed on success.
   * @returns replay result, including the caught error on handler failure.
   */
  async replay(id: string, handler: DlqReplayHandler): Promise<DlqReplayResult> {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry || entry.replayedAt !== null) return { ok: false };

    entry.lastRetryAt = new Date().toISOString();
    entry.retryCount++;
    try {
      await handler(entry.event);
      entry.replayedAt = new Date().toISOString();
      return { ok: true };
    } catch (error) {
      const replayError = normalizeReplayError(error);
      recordReplayError(entry, replayError);
      return { ok: false, error: replayError };
    }
  }

  /**
   * Attempt to replay all pending entries that have not exceeded `maxRetries`.
   * Uses exponential backoff between retries within each attempt.
   * @returns counts of successes and failures, with error details for failures.
   */
  async retryAll(handler: DlqReplayHandler): Promise<DlqRetryAllResult> {
    const pending = this.entries.filter(
      (e) => e.replayedAt === null && e.retryCount < this.maxRetries
    );

    let success = 0;
    let failed = 0;
    const failures: DlqReplayFailure[] = [];

    for (const entry of pending) {
      if (entry.retryCount > 0) {
        const delay = backoffDelay(entry.retryCount, this.retryBaseDelayMs, this.retryMaxDelayMs);
        await sleep(delay);
      }
      const result = await this.replay(entry.id, handler);
      if (result.ok) {
        success++;
      } else {
        failed++;
        if (result.error) {
          failures.push({ id: entry.id, event: entry.event, error: result.error });
        }
      }
    }

    return { success, failed, failures };
  }

  /**
   * Remove an entry from the queue by ID.
   * Returns true if found and removed.
   */
  remove(id: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    return true;
  }

  /**
   * Discard all replayed entries to free memory.
   * Returns the number discarded.
   */
  purgeReplayed(): number {
    const before = this.entries.length;
    const keep = this.entries.filter((e) => e.replayedAt === null);
    this.entries.splice(0, this.entries.length, ...keep);
    return before - this.entries.length;
  }

  /** Export all entries (copy). */
  export(): DeadLetterEntry[] {
    return this.entries.slice();
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function backoffDelay(attempt: number, base: number, cap: number): number {
  return Math.min(base * Math.pow(2, attempt - 1), cap);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recordReplayError(entry: DeadLetterEntry, error: Error): void {
  entry.errorMessage = error.message;
  entry.lastErrorMessage = error.message;
  entry.lastErrorName = error.name;
  entry.lastErrorStack = error.stack;
}

function normalizeReplayError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(formatThrownValue(error), { cause: error });
}

function formatThrownValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    const json = JSON.stringify(value);
    return json ?? String(value);
  } catch {
    return String(value);
  }
}
