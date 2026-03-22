/**
 * Feedback collector — V2-19.
 * Captures explicit user ratings and implicit behavioural signals and stores
 * them in association with the originating interaction.
 *
 * Implicit signals (retries, edits, rephrasing) are treated as negative
 * feedback and are generally more reliable than explicit ratings because they
 * are harder to game.
 */

/** Explicit rating provided directly by the user. */
export type ExplicitRating = "thumbs_up" | "thumbs_down" | "neutral";

/** Category of implicit negative signal. */
export type ImplicitSignalType = "retry" | "edit" | "rephrase" | "abandonment" | "escalation";

export interface ExplicitFeedbackEvent {
  type: "explicit";
  rating: ExplicitRating;
  /** Optional free-text comment from the user. */
  comment?: string;
}

export interface ImplicitFeedbackEvent {
  type: "implicit";
  signal: ImplicitSignalType;
  /** Additional context captured at signal time (e.g. the edited text). */
  context?: Record<string, unknown>;
}

export type FeedbackPayload = ExplicitFeedbackEvent | ImplicitFeedbackEvent;

export interface FeedbackEntry {
  id: string;
  /** Unique identifier of the interaction this feedback relates to. */
  interactionId: string;
  userId: string;
  agentId: string;
  /** The agent action category that produced the interaction (e.g. "summarise", "translate"). */
  actionCategory: string;
  feedback: FeedbackPayload;
  timestamp: Date;
}

export interface FeedbackCollectorConfig {
  /** Maximum number of feedback entries to retain in the store. Oldest are evicted. */
  maxEntries?: number;
  /** When false all collection is paused (useful for testing). */
  enabled?: boolean;
}

/**
 * In-memory feedback store.
 *
 * Entries are kept in insertion order; when the store reaches capacity the
 * oldest entry is removed to make room (FIFO eviction).
 */
export class FeedbackCollector {
  private readonly entries: FeedbackEntry[] = [];
  private readonly maxEntries: number;
  private enabled: boolean;

  constructor(config: FeedbackCollectorConfig = {}) {
    this.maxEntries = config.maxEntries ?? 10_000;
    this.enabled = config.enabled ?? true;
  }

  /** Record a feedback entry. No-ops when collection is disabled. */
  collect(entry: Omit<FeedbackEntry, "id" | "timestamp">): FeedbackEntry | null {
    if (!this.enabled) return null;

    const stored: FeedbackEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    };

    this.entries.push(stored);

    // FIFO eviction
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    return stored;
  }

  /** Return all feedback entries for a specific interaction. */
  getByInteraction(interactionId: string): FeedbackEntry[] {
    return this.entries.filter((e) => e.interactionId === interactionId);
  }

  /** Return all feedback entries for a specific user. */
  getByUser(userId: string): FeedbackEntry[] {
    return this.entries.filter((e) => e.userId === userId);
  }

  /** Return all feedback entries for a specific agent. */
  getByAgent(agentId: string): FeedbackEntry[] {
    return this.entries.filter((e) => e.agentId === agentId);
  }

  /** Return entries within a time range (inclusive). */
  getInTimeRange(from: Date, to: Date): FeedbackEntry[] {
    return this.entries.filter((e) => e.timestamp >= from && e.timestamp <= to);
  }

  /** Return all stored entries (newest last). */
  getAll(): FeedbackEntry[] {
    return [...this.entries];
  }

  /** Total number of stored entries. */
  get size(): number {
    return this.entries.length;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  /** Remove all entries associated with a user (e.g. on account deletion). */
  deleteUserData(userId: string): number {
    let removed = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].userId === userId) {
        this.entries.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }
}
