/**
 * Event Bus — V2-16.
 * Typed in-process publish/subscribe event bus with async handler execution,
 * schema validation, event persistence, and dead-letter queue integration.
 * Designed to start in-process; distributed backends (Redis Streams, Kafka) can
 * be plugged in later without changing the public interface.
 */

import { EventSchemaRegistry, type TypedEvent } from "./event-schema.js";
import { EventStore, type EventStoreConfig } from "./event-store.js";
import { DeadLetterQueue, type DeadLetterQueueConfig } from "./dead-letter-queue.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventHandler<TPayload = unknown> = (
  event: TypedEvent<TPayload>
) => void | Promise<void>;

export interface Subscription {
  /** Unique subscription token. Pass to `unsubscribe()` to cancel. */
  token: string;
  /** The event type pattern this subscription listens on. */
  type: string;
  /** Handler name (for diagnostics/DLQ). */
  handlerName: string;
}

export interface EventBusConfig {
  /**
   * Schema registry to validate payloads before publishing.
   * When omitted a new empty registry is created (no validation).
   */
  schemaRegistry?: EventSchemaRegistry;
  /**
   * Event store configuration.  Pass `false` to disable persistence entirely.
   */
  store?: EventStoreConfig | false;
  /**
   * Dead-letter queue configuration.  Pass `false` to disable the DLQ.
   */
  deadLetterQueue?: DeadLetterQueueConfig | false;
  /**
   * Source tag injected into every published event's `source` field
   * when the caller does not provide one.  Defaults to "event-bus".
   */
  defaultSource?: string;
}

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

/**
 * Central in-process event bus with typed pub/sub semantics.
 *
 * @example
 * const bus = new EventBus();
 * bus.subscribe("user.created", async (evt) => console.log(evt.payload));
 * await bus.publish({ id: "1", type: "user.created", occurredAt: new Date().toISOString(), source: "api", payload: { userId: "u1" } });
 */
export class EventBus {
  readonly registry: EventSchemaRegistry;
  readonly store: EventStore | null;
  readonly dlq: DeadLetterQueue | null;

  private readonly subscriptions = new Map<
    string,
    Array<{ token: string; handlerName: string; handler: EventHandler }>
  >();
  private readonly tokenIndex = new Map<string, string>(); // token → type
  private readonly defaultSource: string;
  private _tokenCounter = 0;

  constructor(config: EventBusConfig = {}) {
    this.registry = config.schemaRegistry ?? new EventSchemaRegistry();
    this.store = config.store === false ? null : new EventStore(config.store ?? {});
    this.dlq = config.deadLetterQueue === false ? null : new DeadLetterQueue(config.deadLetterQueue ?? {});
    this.defaultSource = config.defaultSource ?? "event-bus";
  }

  // ---------------------------------------------------------------------------
  // Subscribe / unsubscribe
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to all events of `type`.
   * Returns a Subscription with a token that can be passed to `unsubscribe()`.
   *
   * @param type Exact event type string.  Use `"*"` to receive every event.
   * @param handler Async or sync handler invoked for each matching event.
   * @param handlerName Optional label used in DLQ records and diagnostics.
   */
  subscribe<TPayload = unknown>(
    type: string,
    handler: EventHandler<TPayload>,
    handlerName?: string
  ): Subscription {
    const token = `sub-${Date.now()}-${++this._tokenCounter}`;
    const name = handlerName ?? `handler-${this._tokenCounter}`;
    if (!this.subscriptions.has(type)) {
      this.subscriptions.set(type, []);
    }
    this.subscriptions.get(type)!.push({ token, handlerName: name, handler: handler as EventHandler });
    this.tokenIndex.set(token, type);
    return { token, type, handlerName: name };
  }

  /**
   * Unsubscribe using a token returned by `subscribe()`.
   * Returns true if the subscription was found and removed.
   */
  unsubscribe(token: string): boolean {
    const type = this.tokenIndex.get(token);
    if (!type) return false;
    const handlers = this.subscriptions.get(type);
    if (!handlers) return false;
    const idx = handlers.findIndex((h) => h.token === token);
    if (idx === -1) return false;
    handlers.splice(idx, 1);
    this.tokenIndex.delete(token);
    if (handlers.length === 0) this.subscriptions.delete(type);
    return true;
  }

  /** Return all active subscriptions. */
  listSubscriptions(): Subscription[] {
    const result: Subscription[] = [];
    for (const [type, handlers] of this.subscriptions) {
      for (const h of handlers) {
        result.push({ token: h.token, type, handlerName: h.handlerName });
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------

  /**
   * Publish an event to all matching subscribers.
   * If the event type is registered in the schema registry the payload is validated first.
   * Handlers run concurrently via `Promise.allSettled`; failures are routed to the DLQ.
   *
   * The event is persisted to the store before handlers are invoked.
   */
  async publish(event: TypedEvent): Promise<void> {
    // Fill in missing source.
    const normalized: TypedEvent = {
      ...event,
      source: event.source || this.defaultSource,
    };

    // Validate if registered.
    if (this.registry.has(normalized.type)) {
      this.registry.validate(normalized.type, normalized.payload);
    }

    // Persist.
    this.store?.append(normalized);

    // Collect handlers: exact-type handlers + wildcard handlers.
    const handlers = [
      ...(this.subscriptions.get(normalized.type) ?? []),
      ...(this.subscriptions.get("*") ?? []),
    ];

    if (handlers.length === 0) return;

    const results = await Promise.allSettled(
      handlers.map((h) => Promise.resolve(h.handler(normalized)))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        const errorMessage =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        this.dlq?.enqueue(normalized, errorMessage, handlers[i].handlerName);
      }
    }
  }

  /**
   * Publish multiple events sequentially, preserving order.
   */
  async publishBatch(events: TypedEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  /** Number of active subscriptions across all event types. */
  get subscriptionCount(): number {
    let count = 0;
    for (const handlers of this.subscriptions.values()) {
      count += handlers.length;
    }
    return count;
  }
}
