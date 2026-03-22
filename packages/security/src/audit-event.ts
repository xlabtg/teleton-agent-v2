/**
 * Audit event schema — V2-14.
 * Defines structured event types for all loggable agent actions, security decisions,
 * and data access events. All sensitive fields must be redacted before storage.
 */

/** Categories of loggable actions */
export type AuditCategory =
  | "authentication"
  | "authorization"
  | "input_validation"
  | "data_access"
  | "agent_action"
  | "rate_limit"
  | "configuration"
  | "system";

/** Outcome of the audited action */
export type AuditOutcome = "success" | "failure" | "blocked" | "quarantined";

/** Severity level for the event (mirrors security severity conventions) */
export type AuditSeverity = "info" | "warning" | "error" | "critical";

/**
 * Core audit event record.
 * All fields must be serialisable to JSON.
 * Raw secrets or PII must never appear in any field — callers are responsible
 * for redacting before constructing an event.
 */
export interface AuditEvent {
  /** Unique event identifier (UUID v4) */
  id: string;
  /** ISO-8601 timestamp when the event occurred */
  timestamp: string;
  /** Category of the audited action */
  category: AuditCategory;
  /** Human-readable action name, e.g. "agent.tool_call" */
  action: string;
  /** Outcome of the action */
  outcome: AuditOutcome;
  /** Severity level */
  severity: AuditSeverity;
  /** Actor that performed the action */
  actor: AuditActor;
  /** Resource that was acted upon (optional) */
  resource?: AuditResource;
  /** Arbitrary structured metadata (must be redacted of secrets/PII) */
  metadata?: Record<string, unknown>;
  /** SHA-256 hash of the previous event for chain integrity (hex) */
  previousHash?: string;
  /** SHA-256 hash of this event for chain integrity (hex) */
  hash?: string;
}

/** Represents the entity that performed the action */
export interface AuditActor {
  /** Type of actor */
  type: "user" | "agent" | "system" | "api_key";
  /** Identifier (user id, agent id, etc.) */
  id: string;
  /** Optional human-readable name */
  name?: string;
  /** Optional namespace / tenant */
  namespace?: string;
  /** Source IP address if applicable */
  ipAddress?: string;
}

/** Represents the resource that was acted upon */
export interface AuditResource {
  /** Resource type, e.g. "message", "tool", "memory" */
  type: string;
  /** Resource identifier */
  id: string;
  /** Optional sub-path / field within the resource */
  path?: string;
}

/**
 * Factory helpers for constructing well-formed audit events.
 * These helpers stamp the timestamp and generate an id automatically.
 */
export function createAuditEvent(
  fields: Omit<AuditEvent, "id" | "timestamp">
): Omit<AuditEvent, "hash" | "previousHash"> {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...fields,
  };
}

/**
 * Returns a copy of the event with all known sensitive keys redacted.
 * Keys matching the redaction list are replaced with "[REDACTED]".
 */
export function redactSensitiveFields(
  event: AuditEvent,
  sensitiveKeys: string[] = DEFAULT_SENSITIVE_KEYS
): AuditEvent {
  if (!event.metadata) return event;
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event.metadata)) {
    redacted[k] = sensitiveKeys.some((s) => k.toLowerCase().includes(s.toLowerCase()))
      ? "[REDACTED]"
      : v;
  }
  return { ...event, metadata: redacted };
}

export const DEFAULT_SENSITIVE_KEYS: string[] = [
  "password",
  "secret",
  "token",
  "key",
  "credential",
  "authorization",
  "private",
  "ssn",
  "credit_card",
  "cvv",
  "pin",
];
