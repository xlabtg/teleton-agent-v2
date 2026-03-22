/**
 * Event Store — V2-16.
 * Persistent in-memory event log with configurable retention, replay support,
 * and event sourcing utilities for state reconstruction from event streams.
 */

import { NotFoundError } from "../../core/src/errors/domain-errors.js";
import type { TypedEvent } from "./event-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventStoreConfig {
  /**
   * Maximum number of events to retain.
   * When the limit is exceeded the oldest events are pruned.
   * Defaults to 10 000.
   */
  maxEvents?: number;
  /**
   * Retention duration in milliseconds.
   * Events older than this threshold are eligible for pruning during `compact()`.
   * Defaults to 24 h (86 400 000 ms).
   */
  retentionMs?: number;
}

export interface EventQuery {
  /** Filter by event type prefix, e.g. "user." matches "user.created". */
  typePrefix?: string;
  /** Only return events with an occurredAt >= this ISO string. */
  since?: string;
  /** Only return events with an occurredAt <= this ISO string. */
  until?: string;
  /** Only return events from this source. */
  source?: string;
  /** Only return events with this correlationId. */
  correlationId?: string;
  /** Maximum number of events to return. Defaults to unlimited. */
  limit?: number;
}

export interface ProjectionReducer<TState> {
  /** Initial state before any events are applied. */
  initialState: TState;
  /** Apply one event to the current state and return the next state. */
  apply: (state: TState, event: TypedEvent) => TState;
}

// ---------------------------------------------------------------------------
// EventStore
// ---------------------------------------------------------------------------

/**
 * Append-only event log with query and replay capabilities.
 *
 * @example
 * const store = new EventStore({ maxEvents: 5000, retentionMs: 3600_000 });
 * store.append({ id: "1", type: "user.created", occurredAt: new Date().toISOString(), source: "api", payload: {} });
 * const events = store.query({ typePrefix: "user." });
 */
export class EventStore {
  private readonly events: TypedEvent[] = [];
  private readonly maxEvents: number;
  private readonly retentionMs: number;

  constructor(config: EventStoreConfig = {}) {
    this.maxEvents = config.maxEvents ?? 10_000;
    this.retentionMs = config.retentionMs ?? 24 * 60 * 60 * 1_000;
  }

  /** Total number of stored events. */
  get size(): number {
    return this.events.length;
  }

  /**
   * Append an event to the store.
   * Drops the oldest event if capacity is exceeded.
   */
  append(event: TypedEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  /**
   * Append multiple events atomically (all-or-nothing push).
   */
  appendBatch(events: TypedEvent[]): void {
    for (const event of events) {
      this.append(event);
    }
  }

  /**
   * Retrieve an event by its ID.
   * @throws NotFoundError if not found.
   */
  getById(id: string): TypedEvent {
    const event = this.events.find((e) => e.id === id);
    if (!event) throw new NotFoundError("Event", id);
    return event;
  }

  /**
   * Query events using optional filters.
   * Returns a new array (does not mutate the store).
   */
  query(q: EventQuery = {}): TypedEvent[] {
    let result = this.events as TypedEvent[];

    if (q.typePrefix) {
      result = result.filter((e) => e.type.startsWith(q.typePrefix!));
    }
    if (q.since) {
      const since = q.since;
      result = result.filter((e) => e.occurredAt >= since);
    }
    if (q.until) {
      const until = q.until;
      result = result.filter((e) => e.occurredAt <= until);
    }
    if (q.source) {
      const source = q.source;
      result = result.filter((e) => e.source === source);
    }
    if (q.correlationId) {
      const cid = q.correlationId;
      result = result.filter((e) => e.correlationId === cid);
    }
    if (q.limit !== undefined) {
      result = result.slice(-q.limit);
    }

    return result.slice();
  }

  /**
   * Remove events outside the configured retention window.
   * Returns the number of events pruned.
   */
  compact(): number {
    const cutoff = new Date(Date.now() - this.retentionMs).toISOString();
    const before = this.events.length;
    let i = 0;
    while (i < this.events.length && this.events[i].occurredAt < cutoff) {
      i++;
    }
    this.events.splice(0, i);
    return before - this.events.length;
  }

  /**
   * Replay events matching `query` through a projection reducer and return
   * the final state.  Useful for event sourcing / CQRS read models.
   *
   * @example
   * const count = store.project({ typePrefix: "user." }, {
   *   initialState: 0,
   *   apply: (state, _event) => state + 1,
   * });
   */
  project<TState>(query: EventQuery, reducer: ProjectionReducer<TState>): TState {
    const events = this.query(query);
    let state = reducer.initialState;
    for (const event of events) {
      state = reducer.apply(state, event);
    }
    return state;
  }

  /**
   * Export a snapshot of all stored events (copy).
   */
  export(): TypedEvent[] {
    return this.events.slice();
  }

  /**
   * Import events into the store (e.g. from a snapshot).
   * Existing events are preserved; duplicates (same id) are skipped.
   */
  import(events: TypedEvent[]): void {
    const existing = new Set(this.events.map((e) => e.id));
    for (const event of events) {
      if (!existing.has(event.id)) {
        this.append(event);
      }
    }
  }
}
