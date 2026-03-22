/**
 * Audit query API — V2-14.
 * Provides filtering, pagination, and export (JSON / CEF) over AuditStore events.
 */

import type { AuditStore, StoredAuditEvent } from "./audit-store.js";
import type { AuditCategory, AuditOutcome, AuditSeverity } from "./audit-event.js";

export interface AuditQueryFilter {
  /** Only events at or after this timestamp */
  since?: Date;
  /** Only events at or before this timestamp */
  until?: Date;
  /** Filter by actor id */
  actorId?: string;
  /** Filter by actor type */
  actorType?: string;
  /** Filter by action (exact match) */
  action?: string;
  /** Filter by category */
  category?: AuditCategory;
  /** Filter by outcome */
  outcome?: AuditOutcome;
  /** Minimum severity to include */
  minSeverity?: AuditSeverity;
}

export interface AuditQueryOptions {
  /** Number of results to skip (for pagination). Default: 0 */
  offset?: number;
  /** Maximum number of results to return. Default: 100 */
  limit?: number;
}

export interface AuditQueryResult {
  events: StoredAuditEvent[];
  total: number;
  offset: number;
  limit: number;
}

const SEVERITY_RANK: Record<AuditSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

export class AuditQuery {
  constructor(private readonly store: AuditStore) {}

  /**
   * Query stored events with optional filtering and pagination.
   * Results are returned newest-first.
   */
  query(filter: AuditQueryFilter = {}, options: AuditQueryOptions = {}): AuditQueryResult {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    const minRank = filter.minSeverity ? SEVERITY_RANK[filter.minSeverity] : 0;

    const all = this.store.getAll({ since: filter.since, until: filter.until });

    const filtered = all.filter((e) => {
      if (filter.actorId && e.actor.id !== filter.actorId) return false;
      if (filter.actorType && e.actor.type !== filter.actorType) return false;
      if (filter.action && e.action !== filter.action) return false;
      if (filter.category && e.category !== filter.category) return false;
      if (filter.outcome && e.outcome !== filter.outcome) return false;
      if (SEVERITY_RANK[e.severity] < minRank) return false;
      return true;
    });

    return {
      events: filtered.slice(offset, offset + limit),
      total: filtered.length,
      offset,
      limit,
    };
  }

  /**
   * Export matching events as newline-delimited JSON (NDJSON).
   * Suitable for ingestion by log management / SIEM systems.
   */
  exportJson(filter: AuditQueryFilter = {}, options: AuditQueryOptions = {}): string {
    const { events } = this.query(filter, options);
    return events.map((e) => JSON.stringify(e)).join("\n");
  }

  /**
   * Export matching events in Common Event Format (CEF) for SIEM integration.
   * Format: CEF:Version|Device Vendor|Device Product|Device Version|Signature ID|Name|Severity|Extension
   */
  exportCef(filter: AuditQueryFilter = {}, options: AuditQueryOptions = {}): string {
    const { events } = this.query(filter, options);
    return events.map((e) => this.toCefLine(e)).join("\n");
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private toCefLine(e: StoredAuditEvent): string {
    const severityNum = this.cefSeverity(e.severity);
    const ext = [
      `act=${e.action}`,
      `outcome=${e.outcome}`,
      `suser=${e.actor.id}`,
      `cat=${e.category}`,
      `rt=${new Date(e.timestamp).getTime()}`,
    ].join(" ");

    // CEF:0|Teleton|SecurityAudit|2.0|<action>|<action>|<severity>|extension
    return `CEF:0|Teleton|SecurityAudit|2.0|${e.action}|${e.action}|${severityNum}|${ext}`;
  }

  private cefSeverity(s: AuditSeverity): number {
    const map: Record<AuditSeverity, number> = { info: 2, warning: 5, error: 7, critical: 10 };
    return map[s];
  }
}
