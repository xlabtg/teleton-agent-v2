/**
 * Environment-based secrets adapter.
 * Reads secrets from environment variables and process-local overrides.
 * set() stores values only for the lifetime of the current Node.js process.
 * delete() removes both the process-local override and the matching process.env key.
 * For production, replace with Vault or AWS Secrets Manager adapter.
 */

import type { SecretsProvider } from "@teleton/core/ports/service.port.js";

export class EnvSecretsAdapter implements SecretsProvider {
  private readonly prefix: string;
  private readonly overrides = new Map<string, string>();

  constructor(prefix: string = "TELETON_") {
    this.prefix = prefix;
  }

  async get(key: string): Promise<string | undefined> {
    return this.overrides.get(key) ?? process.env[`${this.prefix}${key}`];
  }

  async set(key: string, value: string): Promise<void> {
    this.overrides.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.overrides.delete(key);
    delete process.env[`${this.prefix}${key}`];
  }

  async has(key: string): Promise<boolean> {
    return this.overrides.has(key) || `${this.prefix}${key}` in process.env;
  }
}
