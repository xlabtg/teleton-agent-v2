/**
 * Audit logger — V2-14.
 * Middleware that captures audit events at key system boundaries and persists
 * them to an AuditStore. Supports configurable log levels and fire-and-forget
 * dispatch. Use `logAndWait` when callers need durable delivery feedback.
 */

import type { AuditStore } from "./audit-store.js";
import type {
  AuditEvent,
  AuditActor,
  AuditCategory,
  AuditOutcome,
  AuditSeverity,
} from "./audit-event.js";
import { createAuditEvent } from "./audit-event.js";

export type AuditLogLevel = "info" | "warning" | "error" | "critical";

export interface AuditLoggerConfig {
  /** Minimum severity to persist. Events below this level are dropped. Default: "info" */
  minSeverity?: AuditLogLevel;
  /** Categories to suppress entirely. Default: [] */
  suppressedCategories?: AuditCategory[];
  /** Called when the store write fails. Default: logs to console.error. */
  onError?: (err: unknown, event: AuditEvent) => void;
}

const SEVERITY_RANK: Record<AuditLogLevel, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

export class AuditLogger {
  private readonly minSeverityRank: number;
  private readonly suppressedCategories: Set<AuditCategory>;
  private readonly onError: (err: unknown, event: AuditEvent) => void;
  private failedWrites = 0;

  constructor(
    private readonly store: AuditStore,
    config: AuditLoggerConfig = {}
  ) {
    this.minSeverityRank = SEVERITY_RANK[config.minSeverity ?? "info"];
    this.suppressedCategories = new Set(config.suppressedCategories ?? []);
    this.onError = config.onError ?? defaultOnError;
  }

  /**
   * Log an audit event.
   * This call is fire-and-forget: storage errors are routed to `onError` and
   * counted by `failureCount`, but never propagate to the caller. Use
   * `logAndWait` when the caller must know whether the event was persisted.
   */
  log(
    actor: AuditActor,
    action: string,
    category: AuditCategory,
    outcome: AuditOutcome,
    severity: AuditSeverity,
    metadata?: Record<string, unknown>
  ): void {
    const event = this.createEvent(actor, action, category, outcome, severity, metadata);
    if (!event) return;
    this.store.append(event as AuditEvent).catch((err: unknown) => {
      this.handleStoreError(err, event as AuditEvent);
    });
  }

  /**
   * Log an audit event and wait for the store write to complete.
   * Returns `undefined` when severity/category filters suppress the event.
   * Store failures are counted, routed to `onError`, and then rethrown.
   */
  async logAndWait(
    actor: AuditActor,
    action: string,
    category: AuditCategory,
    outcome: AuditOutcome,
    severity: AuditSeverity,
    metadata?: Record<string, unknown>
  ): Promise<AuditEvent | undefined> {
    const event = this.createEvent(actor, action, category, outcome, severity, metadata);
    if (!event) return undefined;

    try {
      await this.store.append(event as AuditEvent);
      return event as AuditEvent;
    } catch (err) {
      this.handleStoreError(err, event as AuditEvent);
      throw err;
    }
  }

  /** Number of failed store writes observed by this logger instance. */
  get failureCount(): number {
    return this.failedWrites;
  }

  /** Convenience: log a successful action at info severity */
  logSuccess(
    actor: AuditActor,
    action: string,
    category: AuditCategory,
    metadata?: Record<string, unknown>
  ): void {
    this.log(actor, action, category, "success", "info", metadata);
  }

  /** Convenience: log a blocked/failed action at warning severity */
  logBlocked(
    actor: AuditActor,
    action: string,
    category: AuditCategory,
    metadata?: Record<string, unknown>
  ): void {
    this.log(actor, action, category, "blocked", "warning", metadata);
  }

  /** Convenience: log a failure at error severity */
  logFailure(
    actor: AuditActor,
    action: string,
    category: AuditCategory,
    metadata?: Record<string, unknown>
  ): void {
    this.log(actor, action, category, "failure", "error", metadata);
  }

  /** Convenience: log a quarantined event at warning severity */
  logQuarantined(
    actor: AuditActor,
    action: string,
    category: AuditCategory,
    metadata?: Record<string, unknown>
  ): void {
    this.log(actor, action, category, "quarantined", "warning", metadata);
  }

  /**
   * Wrap an async operation with automatic success/failure audit logging.
   * Returns the operation result or rethrows the original error.
   */
  async wrap<T>(
    actor: AuditActor,
    action: string,
    category: AuditCategory,
    operation: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    try {
      const result = await operation();
      this.logSuccess(actor, action, category, metadata);
      return result;
    } catch (err) {
      this.logFailure(actor, action, category, {
        ...metadata,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private createEvent(
    actor: AuditActor,
    action: string,
    category: AuditCategory,
    outcome: AuditOutcome,
    severity: AuditSeverity,
    metadata?: Record<string, unknown>
  ): AuditEvent | undefined {
    if (SEVERITY_RANK[severity] < this.minSeverityRank) return undefined;
    if (this.suppressedCategories.has(category)) return undefined;

    return createAuditEvent({ actor, action, category, outcome, severity, metadata }) as AuditEvent;
  }

  private handleStoreError(err: unknown, event: AuditEvent): void {
    this.failedWrites += 1;
    this.onError(err, event);
  }
}

function defaultOnError(err: unknown, event: AuditEvent): void {
  // eslint-disable-next-line no-console -- Default audit write failures must be observable.
  console.error("Audit log store write failed", {
    err,
    eventId: event.id,
    actor: event.actor,
    action: event.action,
    category: event.category,
    outcome: event.outcome,
    severity: event.severity,
  });
}
