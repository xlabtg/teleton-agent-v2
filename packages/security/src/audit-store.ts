/**
 * Audit store — V2-14.
 * Append-only in-memory log store with SHA-256 hash chaining for tamper-evidence.
 * Each stored event is hashed and the hash is included in the next event's
 * `previousHash` field, forming a verifiable chain.
 *
 * Sensitive fields are automatically redacted on write via `redactSensitiveFields`.
 * Retention TTLs are enforced lazily on read and on explicit `purgeExpired()` calls.
 */

import type { AuditEvent } from "./audit-event.js";
import { redactSensitiveFields, DEFAULT_SENSITIVE_KEYS } from "./audit-event.js";

export interface AuditStoreConfig {
  /** Additional sensitive field name fragments to redact (merged with defaults) */
  additionalSensitiveKeys?: string[];
  /** Default TTL in milliseconds for all categories. 0 = keep forever. Default: 0 */
  defaultRetentionMs?: number;
  /** Per-category TTL overrides in milliseconds */
  retentionByCategory?: Partial<Record<string, number>>;
  /** Maximum number of events to keep in memory. 0 = unlimited. Default: 0 */
  maxEvents?: number;
}

export interface StoredAuditEvent extends AuditEvent {
  hash: string;
  previousHash: string;
}

export class AuditStore {
  private readonly events: StoredAuditEvent[] = [];
  private lastHash = "";
  private readonly sensitiveKeys: string[];
  private readonly defaultRetentionMs: number;
  private readonly retentionByCategory: Partial<Record<string, number>>;
  private readonly maxEvents: number;

  constructor(config: AuditStoreConfig = {}) {
    this.sensitiveKeys = [...DEFAULT_SENSITIVE_KEYS, ...(config.additionalSensitiveKeys ?? [])];
    this.defaultRetentionMs = config.defaultRetentionMs ?? 0;
    this.retentionByCategory = config.retentionByCategory ?? {};
    this.maxEvents = config.maxEvents ?? 0;
  }

  /**
   * Append an event to the store.
   * The event is redacted, stamped with the chain hash, and stored immutably.
   * Returns the stored event including its hash fields.
   */
  async append(event: AuditEvent): Promise<StoredAuditEvent> {
    const redacted = redactSensitiveFields(event, this.sensitiveKeys);
    const previousHash = this.lastHash;
    const hash = await this.computeHash(redacted, previousHash);

    const stored: StoredAuditEvent = { ...redacted, previousHash, hash };
    this.events.push(stored);
    this.lastHash = hash;

    // Enforce maxEvents cap (drop oldest)
    if (this.maxEvents > 0 && this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }

    return stored;
  }

  /**
   * Return all stored events (newest first) filtered by optional time range.
   * Expired events are excluded automatically.
   */
  getAll(options: { since?: Date; until?: Date } = {}): StoredAuditEvent[] {
    const now = Date.now();
    return [...this.events]
      .filter((e) => !this.isExpired(e, now))
      .filter((e) => {
        const ts = new Date(e.timestamp).getTime();
        if (options.since && ts < options.since.getTime()) return false;
        if (options.until && ts > options.until.getTime()) return false;
        return true;
      })
      .reverse();
  }

  /**
   * Verify the integrity of the full event chain.
   * Returns `true` if every event's hash is consistent with its content and
   * the previous event's hash.
   */
  async verifyIntegrity(): Promise<boolean> {
    let prev = "";
    for (const event of this.events) {
      // Strip hash fields so we recompute from the original content only
      const { hash: _h, previousHash: _p, ...content } = event;
      const expected = await this.computeHash(content as AuditEvent, prev);
      if (expected !== _h) return false;
      prev = _h;
    }
    return true;
  }

  /**
   * Remove events that have exceeded their retention TTL.
   * Returns the number of events removed.
   */
  purgeExpired(): number {
    const now = Date.now();
    const before = this.events.length;
    let i = 0;
    while (i < this.events.length) {
      if (this.isExpired(this.events[i], now)) {
        this.events.splice(i, 1);
      } else {
        i++;
      }
    }
    return before - this.events.length;
  }

  get size(): number {
    return this.events.length;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private isExpired(event: StoredAuditEvent, nowMs: number): boolean {
    const ttl = this.retentionByCategory[event.category] ?? this.defaultRetentionMs;
    if (!ttl) return false;
    return nowMs - new Date(event.timestamp).getTime() > ttl;
  }

  private async computeHash(
    event: Omit<AuditEvent, "hash" | "previousHash">,
    previousHash: string
  ): Promise<string> {
    const payload = JSON.stringify({ event, previousHash });
    const data = new TextEncoder().encode(payload);
    const buffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}
