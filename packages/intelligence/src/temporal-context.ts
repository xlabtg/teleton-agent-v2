/**
 * Temporal Context — V2-11.
 * Attaches timestamp metadata to context items and applies time-decay
 * weighting so that recent information is ranked higher than stale data
 * during context retrieval.
 */

import { TimeParser } from "./time-parser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A piece of context with temporal metadata attached. */
export interface TemporalContextItem {
  /** Unique identifier for this context item. */
  id: string;
  /** Raw textual content. */
  content: string;
  /** When this item was created or last updated. */
  timestamp: Date;
  /**
   * The user-supplied timezone offset in minutes (e.g. +60 for UTC+1).
   * Stored so the item can be displayed in the user's local time later.
   */
  userUtcOffsetMinutes?: number;
  /** Optional tag classifying the kind of context (e.g. "message", "note", "event"). */
  tag?: string;
  /** Arbitrary extra metadata. */
  metadata?: Record<string, unknown>;
}

export interface TemporalContextConfig {
  /**
   * Half-life for the decay function in milliseconds.
   * After this duration the relevance score halves. Default: 24 h.
   */
  decayHalfLifeMs?: number;
  /**
   * Maximum number of items to retain in the store.
   * When exceeded, the least-relevant item is evicted. Default: 500.
   */
  maxItems?: number;
  /** Reference clock used instead of Date.now(). Useful for deterministic tests. */
  referenceDate?: Date;
}

export interface ScoredItem {
  item: TemporalContextItem;
  /** Value in [0, 1]. 1 = just created, approaching 0 as item ages. */
  score: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * In-memory store of context items with time-decay scoring.
 * Items are retrieved ordered by relevance (most-recent = highest score).
 */
export class TemporalContext {
  private readonly items = new Map<string, TemporalContextItem>();
  private readonly decayHalfLifeMs: number;
  private readonly maxItems: number;
  private referenceDate: Date | undefined;

  constructor(config: TemporalContextConfig = {}) {
    this.decayHalfLifeMs = config.decayHalfLifeMs ?? 24 * 3_600_000;
    this.maxItems = config.maxItems ?? 500;
    this.referenceDate = config.referenceDate;
  }

  /** Override the reference clock (useful in tests). */
  setReferenceDate(date: Date): void {
    this.referenceDate = date;
  }

  private now(): Date {
    return this.referenceDate ?? new Date();
  }

  /**
   * Add or update a context item.
   * When the store is full, the lowest-scoring item is evicted first.
   */
  add(item: Omit<TemporalContextItem, "id"> & { id?: string }): TemporalContextItem {
    const stored: TemporalContextItem = {
      ...item,
      id: item.id ?? crypto.randomUUID(),
    };

    if (!this.items.has(stored.id) && this.items.size >= this.maxItems) {
      this._evictLowest();
    }

    this.items.set(stored.id, stored);
    return stored;
  }

  /** Remove an item by id. No-op if not found. */
  remove(id: string): void {
    this.items.delete(id);
  }

  /** Return a single item by id, or undefined if not found. */
  get(id: string): TemporalContextItem | undefined {
    return this.items.get(id);
  }

  /** Return the number of items in the store. */
  get size(): number {
    return this.items.size;
  }

  /**
   * Compute the time-decay relevance score for an item.
   * Uses an exponential decay: score = 2^(-ageMs / halfLife).
   */
  scoreOf(item: TemporalContextItem): number {
    const ageMs = this.now().getTime() - item.timestamp.getTime();
    if (ageMs <= 0) return 1;
    return Math.pow(2, -ageMs / this.decayHalfLifeMs);
  }

  /**
   * Retrieve all items sorted by relevance score (highest first).
   * Optionally filter by tag.
   */
  retrieve(options: { tag?: string; limit?: number } = {}): ScoredItem[] {
    let items = Array.from(this.items.values());
    if (options.tag) {
      items = items.filter((i) => i.tag === options.tag);
    }

    const scored: ScoredItem[] = items.map((item) => ({
      item,
      score: this.scoreOf(item),
    }));

    scored.sort((a, b) => b.score - a.score);

    if (options.limit !== undefined) {
      return scored.slice(0, options.limit);
    }
    return scored;
  }

  /**
   * Parse temporal expressions found in a text string and add them as
   * TemporalContextItems timestamped at the resolved date.
   * Returns the newly created items.
   */
  extractAndAdd(
    text: string,
    options: {
      tag?: string;
      userUtcOffsetMinutes?: number;
      metadata?: Record<string, unknown>;
    } = {}
  ): TemporalContextItem[] {
    const parser = new TimeParser({
      referenceDate: this.now(),
      userUtcOffsetMinutes: options.userUtcOffsetMinutes,
    });
    const extractions = parser.extractAll(text);
    const created: TemporalContextItem[] = [];

    for (const { match, parsed } of extractions) {
      if (parsed.kind === "unrecognized") continue;
      const date =
        parsed.kind === "absolute" || parsed.kind === "relative"
          ? parsed.date
          : parsed.candidates[0];

      const item = this.add({
        content: match,
        timestamp: date,
        tag: options.tag,
        userUtcOffsetMinutes: options.userUtcOffsetMinutes,
        metadata: { ...options.metadata, source: text },
      });
      created.push(item);
    }

    return created;
  }

  /** Remove all items whose score has fallen below the given threshold. */
  pruneStale(threshold = 0.01): number {
    let removed = 0;
    for (const [id, item] of this.items) {
      if (this.scoreOf(item) < threshold) {
        this.items.delete(id);
        removed++;
      }
    }
    return removed;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _evictLowest(): void {
    let lowestId: string | undefined;
    let lowestScore = Infinity;
    for (const [id, item] of this.items) {
      const score = this.scoreOf(item);
      if (score < lowestScore) {
        lowestScore = score;
        lowestId = id;
      }
    }
    if (lowestId) this.items.delete(lowestId);
  }
}
