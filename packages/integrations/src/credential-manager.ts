/**
 * Credential Manager — V2-15.
 * Centralised credential storage with environment-based configuration and
 * zero-downtime rotation support. Credentials are never logged or serialised.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
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

interface StoredCredentialRecord {
  serviceId: string;
  stored: StoredCredentialValue;
  rotatedAt: string;
  meta?: Record<string, unknown>;
}

type StoredCredentialValue =
  | { kind: "plain"; value: unknown }
  | { kind: "encrypted"; payload: EncryptedCredentialPayload };

interface EncryptedCredentialPayload {
  iv: string;
  authTag: string;
  ciphertext: string;
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
  /**
   * Optional key used to encrypt credentials while stored in memory.
   * When omitted, values are still defensively cloned and frozen.
   */
  encryptionKey?: string | Uint8Array;
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
  private readonly records = new Map<string, StoredCredentialRecord>();
  private readonly envPrefix: string;
  private readonly encryptionKey?: Buffer;

  constructor(config: CredentialManagerConfig = {}) {
    this.envPrefix = config.envPrefix ?? "TELETON_CRED";
    this.encryptionKey = config.encryptionKey
      ? deriveEncryptionKey(config.encryptionKey)
      : undefined;
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
    return freezeDeep(cloneCredential(this._readStoredValue(record.stored)));
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
    return freezeDeep({
      serviceId: record.serviceId,
      value: this._readStoredValue(record.stored),
      rotatedAt: record.rotatedAt,
      ...(record.meta ? { meta: cloneCredential(record.meta) } : {}),
    });
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
      stored: this._writeStoredValue(value),
      rotatedAt: new Date().toISOString(),
      ...(meta ? { meta: freezeDeep(cloneCredential(meta)) as Record<string, unknown> } : {}),
    });
  }

  private _writeStoredValue(value: unknown): StoredCredentialValue {
    const cloned = cloneCredential(value);
    if (!this.encryptionKey) {
      return { kind: "plain", value: freezeDeep(cloned) };
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const plaintext = Buffer.from(JSON.stringify(cloned), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    return {
      kind: "encrypted",
      payload: {
        iv: iv.toString("base64url"),
        authTag: cipher.getAuthTag().toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
      },
    };
  }

  private _readStoredValue(stored: StoredCredentialValue): unknown {
    if (stored.kind === "plain") {
      return cloneCredential(stored.value);
    }

    if (!this.encryptionKey) {
      throw new ConfigurationError("Credential encryption key is required to decrypt credential.");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.encryptionKey,
      Buffer.from(stored.payload.iv, "base64url")
    );
    decipher.setAuthTag(Buffer.from(stored.payload.authTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(stored.payload.ciphertext, "base64url")),
      decipher.final(),
    ]);

    return JSON.parse(plaintext.toString("utf8")) as unknown;
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

function deriveEncryptionKey(key: string | Uint8Array): Buffer {
  return createHash("sha256").update(key).digest();
}

function cloneCredential<T>(value: T): T {
  return structuredClone(value);
}

function freezeDeep<T>(value: T): T {
  if (!isFreezable(value) || Object.isFrozen(value)) {
    return value;
  }

  for (const nested of Object.values(value)) {
    freezeDeep(nested);
  }

  return Object.freeze(value);
}

function isFreezable(value: unknown): value is Record<string, unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}
