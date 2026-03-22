/**
 * Event Schema — V2-16.
 * Typed event definitions, schema validation via Zod, and a runtime type registry
 * that maps event names to their validators.
 */

import { z } from "zod";
import { ValidationError } from "../../core/src/errors/domain-errors.js";

// ---------------------------------------------------------------------------
// Core event shape
// ---------------------------------------------------------------------------

/**
 * Base fields required on every event in the system.
 */
export interface BaseEvent {
  /** Unique event identifier (UUIDv4 recommended). */
  id: string;
  /** Dot-namespaced event type, e.g. "user.created" or "api.call.failed". */
  type: string;
  /** ISO timestamp when this event was emitted. */
  occurredAt: string;
  /** Emitting component or service, e.g. "api-gateway". */
  source: string;
  /** Correlation ID for tracing across services. Optional. */
  correlationId?: string;
}

export const BaseEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  occurredAt: z.string().datetime(),
  source: z.string().min(1),
  correlationId: z.string().optional(),
});

/**
 * A fully typed event: base fields plus an arbitrary payload.
 */
export type TypedEvent<TPayload = unknown> = BaseEvent & {
  payload: TPayload;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface EventTypeEntry<TPayload = unknown> {
  /** The event type string, e.g. "user.created". */
  type: string;
  /** Zod schema for the event payload. */
  payloadSchema: z.ZodType<TPayload>;
  /** Human-readable description. */
  description?: string;
}

/**
 * Runtime registry of event type definitions.
 * Validates event payloads on publish and replay.
 *
 * @example
 * const registry = new EventSchemaRegistry();
 * registry.register({ type: "user.created", payloadSchema: z.object({ userId: z.string() }) });
 * registry.validate("user.created", { userId: "abc" }); // passes
 */
export class EventSchemaRegistry {
  private readonly entries = new Map<string, EventTypeEntry>();

  /**
   * Register an event type with its Zod payload schema.
   * Re-registration overwrites the existing entry.
   */
  register<TPayload>(entry: EventTypeEntry<TPayload>): void {
    this.entries.set(entry.type, entry as EventTypeEntry);
  }

  /** Return the registered entry for a type, or undefined. */
  getEntry(type: string): EventTypeEntry | undefined {
    return this.entries.get(type);
  }

  /** Return true if the type is registered. */
  has(type: string): boolean {
    return this.entries.has(type);
  }

  /** Return all registered event type strings. */
  listTypes(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Validate a payload against the registered schema for `type`.
   * @throws ValidationError if validation fails or the type is unknown.
   */
  validate(type: string, payload: unknown): void {
    const entry = this.entries.get(type);
    if (!entry) {
      throw new ValidationError(`Unknown event type "${type}". Register it first.`);
    }
    const result = entry.payloadSchema.safeParse(payload);
    if (!result.success) {
      const details: Record<string, string[]> = {};
      for (const e of result.error.errors) {
        const key = e.path.join(".") || "root";
        (details[key] ??= []).push(e.message);
      }
      throw new ValidationError(
        `Payload validation failed for event type "${type}".`,
        details
      );
    }
  }

  /**
   * Build a complete TypedEvent from raw fields and a payload.
   * Validates the payload before building.
   */
  build<TPayload>(
    type: string,
    payload: TPayload,
    overrides: Partial<Omit<BaseEvent, "type">> = {}
  ): TypedEvent<TPayload> {
    this.validate(type, payload);
    return {
      id: overrides.id ?? generateId(),
      type,
      occurredAt: overrides.occurredAt ?? new Date().toISOString(),
      source: overrides.source ?? "unknown",
      correlationId: overrides.correlationId,
      payload,
    };
  }
}

// ---------------------------------------------------------------------------
// Built-in common event schemas
// ---------------------------------------------------------------------------

export const ApiCallEventPayloadSchema = z.object({
  serviceId: z.string(),
  method: z.string(),
  path: z.string(),
  status: z.number(),
  durationMs: z.number(),
});

export type ApiCallEventPayload = z.infer<typeof ApiCallEventPayloadSchema>;

export const ErrorEventPayloadSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  serviceId: z.string().optional(),
});

export type ErrorEventPayload = z.infer<typeof ErrorEventPayloadSchema>;

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

let _counter = 0;

function generateId(): string {
  // Simple incrementing ID adequate for in-process use.
  // Replace with crypto.randomUUID() in Node 19+.
  return `evt-${Date.now()}-${++_counter}`;
}
