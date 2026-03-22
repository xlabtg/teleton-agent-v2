/**
 * Credential Manager — V2-15.
 * Centralised credential storage with environment-based configuration and
 * zero-downtime rotation support. Credentials are never logged or serialised.
 */

import { ConfigurationError, NotFoundError } from "../../core/src/errors/domain-errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CredentialRecord {
  /** Service identifier, e.g. "openai" or "telegram". */
  serviceId: string;
  /** Opaque credential value. Shape is service-specific. */
  value: unknown;
  /** ISO timestamp when this credential was last rotated. */
  rotatedAt: string;
  /** Optional metadata such as expiry time or scopes. */
  meta?: Record<string, unknown>;
}

export interface CredentialManagerConfig {
  /**
   * Initial credential map.  Keys are service IDs; values are opaque credentials.
   * Useful for testing or seeding credentials programmatically.
   */
  initial?: Record<string, unknown>;
  /**
   * Environment variable prefix.  When set the manager will also look for
   * `${prefix}_${SERVICEID_UPPER}` variables on construction.
   * Defaults to "TELETON_CRED".
   */
  envPrefix?: string;
}

// ---------------------------------------------------------------------------
// CredentialManager
// ---------------------------------------------------------------------------

/**
 * Stores and rotates credentials for external services.
 * Supports both programmatic seeding and environment-variable bootstrapping.
 *
 * @example
 * const mgr = new CredentialManager({ envPrefix: "TELETON_CRED" });
 * mgr.set("openai", { apiKey: "sk-..." });
 * const cred = mgr.get("openai");
 */
export class CredentialManager {
  private readonly records = new Map<string, CredentialRecord>();
  private readonly envPrefix: string;

  constructor(config: CredentialManagerConfig = {}) {
    this.envPrefix = config.envPrefix ?? "TELETON_CRED";
    if (config.initial) {
      for (const [serviceId, value] of Object.entries(config.initial)) {
        this._store(serviceId, value);
      }
    }
    this._loadFromEnv();
  }

  /**
   * Store or replace a credential for the given service.
   * Updates `rotatedAt` to the current ISO timestamp.
   */
  set(serviceId: string, value: unknown, meta?: Record<string, unknown>): void {
    validateServiceId(serviceId);
    this._store(serviceId, value, meta);
  }

  /**
   * Retrieve the credential value for a service.
   * @throws NotFoundError if no credential is registered.
   */
  get(serviceId: string): unknown {
    const record = this.records.get(normalise(serviceId));
    if (!record) {
      throw new NotFoundError("Credential", serviceId);
    }
    return record.value;
  }

  /**
   * Retrieve the full record including metadata.
   * @throws NotFoundError if no credential is registered.
   */
  getRecord(serviceId: string): Readonly<CredentialRecord> {
    const record = this.records.get(normalise(serviceId));
    if (!record) {
      throw new NotFoundError("Credential", serviceId);
    }
    return record;
  }

  /** Return true if a credential is registered for the given service. */
  has(serviceId: string): boolean {
    return this.records.has(normalise(serviceId));
  }

  /** Remove the credential for a service. Returns true if it existed. */
  delete(serviceId: string): boolean {
    return this.records.delete(normalise(serviceId));
  }

  /**
   * Rotate a credential by replacing it with a new value.
   * Equivalent to `set`, but throws if no existing record is found,
   * preventing accidental registration of unknown services.
   *
   * @throws NotFoundError if the service has no existing credential.
   */
  rotate(serviceId: string, newValue: unknown, meta?: Record<string, unknown>): void {
    const key = normalise(serviceId);
    if (!this.records.has(key)) {
      throw new NotFoundError("Credential", serviceId);
    }
    this._store(serviceId, newValue, meta);
  }

  /** Return the list of registered service IDs. */
  listServices(): string[] {
    return Array.from(this.records.keys());
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _store(serviceId: string, value: unknown, meta?: Record<string, unknown>): void {
    this.records.set(normalise(serviceId), {
      serviceId: normalise(serviceId),
      value,
      rotatedAt: new Date().toISOString(),
      ...(meta ? { meta } : {}),
    });
  }

  private _loadFromEnv(): void {
    if (typeof process === "undefined") return;
    const prefix = `${this.envPrefix}_`;
    for (const [key, value] of Object.entries(process.env)) {
      if (!key.startsWith(prefix) || value === undefined) continue;
      const serviceId = key.slice(prefix.length).toLowerCase();
      if (serviceId.length === 0) continue;
      // Only seed from env if not already set programmatically.
      if (!this.records.has(serviceId)) {
        this._store(serviceId, value);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function normalise(serviceId: string): string {
  return serviceId.trim().toLowerCase();
}

function validateServiceId(serviceId: string): void {
  if (!serviceId || serviceId.trim().length === 0) {
    throw new ConfigurationError("Service ID must be a non-empty string.");
  }
}
