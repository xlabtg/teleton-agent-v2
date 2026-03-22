/**
 * Prompt registry — V2-20.
 * A versioned store for prompt templates.  Each template can have multiple
 * versions; the registry tracks which version is currently promoted (active).
 *
 * Versions are immutable once created so the full history is always available
 * for review and rollback.
 */

export interface PromptVersion {
  version: number;
  /** Raw template text, may contain {{variable}} placeholders. */
  template: string;
  /** Free-text description of what changed in this version. */
  changelog: string;
  createdAt: Date;
  /** Whether this version is the active one for its template key. */
  active: boolean;
}

export interface PromptTemplate {
  /** Stable identifier used throughout the system (e.g. "summarise-v2"). */
  key: string;
  description: string;
  versions: PromptVersion[];
  /** Version number that is currently active (or null if none promoted yet). */
  activeVersion: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PromptRegistryConfig {
  /** Maximum number of versions to retain per template. Oldest are pruned. */
  maxVersionsPerTemplate?: number;
}

/**
 * CRUD registry for prompt templates with version history.
 *
 * Safety note: templates that affect safety or security guardrails should
 * never be mutated through this registry without a human review gate.
 */
export class PromptRegistry {
  private readonly templates = new Map<string, PromptTemplate>();
  private readonly maxVersions: number;

  constructor(config: PromptRegistryConfig = {}) {
    this.maxVersions = config.maxVersionsPerTemplate ?? 50;
  }

  /** Register a new template with its first version. */
  register(
    key: string,
    template: string,
    description: string,
    changelog = "Initial version"
  ): PromptTemplate {
    if (this.templates.has(key)) {
      throw new Error(
        `Template '${key}' is already registered. Use addVersion() to add a new version.`
      );
    }

    const now = new Date();
    const firstVersion: PromptVersion = {
      version: 1,
      template,
      changelog,
      createdAt: now,
      active: false,
    };

    const stored: PromptTemplate = {
      key,
      description,
      versions: [firstVersion],
      activeVersion: null,
      createdAt: now,
      updatedAt: now,
    };

    this.templates.set(key, stored);
    return stored;
  }

  /** Add a new version to an existing template (does not promote it). */
  addVersion(key: string, template: string, changelog: string): PromptVersion {
    const pt = this.getOrThrow(key);
    const nextVersion =
      pt.versions.length > 0 ? pt.versions[pt.versions.length - 1].version + 1 : 1;

    const newVersion: PromptVersion = {
      version: nextVersion,
      template,
      changelog,
      createdAt: new Date(),
      active: false,
    };

    pt.versions.push(newVersion);
    pt.updatedAt = new Date();

    // Prune oldest versions if over the limit, preserving active version
    while (pt.versions.length > this.maxVersions) {
      const idx = pt.versions.findIndex((v) => !v.active);
      if (idx === -1) break; // all versions are active (shouldn't happen)
      pt.versions.splice(idx, 1);
    }

    return newVersion;
  }

  /**
   * Promote a specific version to be the active (live) version.
   * Marks all other versions as inactive.
   */
  promote(key: string, version: number): PromptTemplate {
    const pt = this.getOrThrow(key);
    const target = pt.versions.find((v) => v.version === version);
    if (!target) {
      throw new Error(`Version ${version} not found for template '${key}'`);
    }

    for (const v of pt.versions) {
      v.active = v.version === version;
    }
    pt.activeVersion = version;
    pt.updatedAt = new Date();
    return pt;
  }

  /**
   * Roll back to the previous version.
   * Returns null if there is no previous version to roll back to.
   */
  rollback(key: string): PromptTemplate | null {
    const pt = this.getOrThrow(key);
    if (pt.activeVersion === null) return null;

    const sortedVersions = [...pt.versions].sort((a, b) => a.version - b.version);
    const currentIdx = sortedVersions.findIndex((v) => v.version === pt.activeVersion);

    if (currentIdx <= 0) return null; // already on the oldest version

    const previous = sortedVersions[currentIdx - 1];
    return this.promote(key, previous.version);
  }

  /** Return the active prompt template text, or null if no version is active. */
  getActiveTemplate(key: string): string | null {
    const pt = this.templates.get(key);
    if (!pt || pt.activeVersion === null) return null;
    return pt.versions.find((v) => v.version === pt.activeVersion)?.template ?? null;
  }

  /** Return a specific version of a template. */
  getVersion(key: string, version: number): PromptVersion | undefined {
    return this.templates.get(key)?.versions.find((v) => v.version === version);
  }

  /** Return the full template record including all versions. */
  get(key: string): PromptTemplate | undefined {
    return this.templates.get(key);
  }

  /** Return all registered template records. */
  list(): PromptTemplate[] {
    return [...this.templates.values()];
  }

  /** Remove a template and all its versions (use with care). */
  delete(key: string): boolean {
    return this.templates.delete(key);
  }

  private getOrThrow(key: string): PromptTemplate {
    const pt = this.templates.get(key);
    if (!pt) throw new Error(`Template '${key}' not found`);
    return pt;
  }
}
