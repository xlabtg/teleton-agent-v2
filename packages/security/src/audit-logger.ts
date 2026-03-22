/**
 * Audit logger — V2-14.
 * Middleware that captures audit events at key system boundaries and persists
 * them to an AuditStore. Supports configurable log levels and synchronous
 * "fire-and-forget" dispatch with optional error callback.
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
  /** Called when the store write fails. Default: silent. */
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
  private readonly onError: ((err: unknown, event: AuditEvent) => void) | undefined;

  constructor(
    private readonly store: AuditStore,
    config: AuditLoggerConfig = {}
  ) {
    this.minSeverityRank = SEVERITY_RANK[config.minSeverity ?? "info"];
    this.suppressedCategories = new Set(config.suppressedCategories ?? []);
    this.onError = config.onError;
  }

  /**
   * Log an audit event.
   * The call is fire-and-forget — storage errors are routed to `onError` (if set)
   * and never propagate to the caller.
   */
  log(
    actor: AuditActor,
    action: string,
    category: AuditCategory,
    outcome: AuditOutcome,
    severity: AuditSeverity,
    metadata?: Record<string, unknown>
  ): void {
    if (SEVERITY_RANK[severity] < this.minSeverityRank) return;
    if (this.suppressedCategories.has(category)) return;

    const event = createAuditEvent({ actor, action, category, outcome, severity, metadata });
    this.store.append(event as AuditEvent).catch((err: unknown) => {
      this.onError?.(err, event as AuditEvent);
    });
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
}
