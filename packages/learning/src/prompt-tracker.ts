/**
 * Prompt tracker — V2-20.
 * Records every prompt usage and its outcome score.  This data drives the
 * optimization loop in PromptOptimizer.
 *
 * Scores are normalised to [0, 1] where 1 = perfect outcome and 0 = failure.
 * Callers decide the scoring logic; the tracker simply accumulates records.
 */

export interface PromptUsageRecord {
  id: string;
  /** Template key that was used. */
  templateKey: string;
  /** Version number of the template that was active at usage time. */
  templateVersion: number;
  /** Interaction or request identifier for correlation with other logs. */
  interactionId: string;
  usedAt: Date;
}

export interface PromptOutcomeRecord {
  id: string;
  usageId: string;
  templateKey: string;
  templateVersion: number;
  /** Normalised score [0, 1]. */
  score: number;
  recordedAt: Date;
}

export interface VersionStats {
  templateKey: string;
  version: number;
  usageCount: number;
  scoredCount: number;
  /** Mean score across all scored outcomes.  null if no outcomes recorded. */
  meanScore: number | null;
}

export interface PromptTrackerConfig {
  /** Maximum number of usage records to retain. Oldest are evicted (FIFO). */
  maxUsageRecords?: number;
}

/**
 * Tracks prompt usage and outcome scores to feed the optimization loop.
 */
export class PromptTracker {
  private readonly usageRecords: PromptUsageRecord[] = [];
  private readonly outcomeRecords: PromptOutcomeRecord[] = [];
  private readonly maxUsageRecords: number;

  constructor(config: PromptTrackerConfig = {}) {
    this.maxUsageRecords = config.maxUsageRecords ?? 50_000;
  }

  /** Record that a prompt template was used for an interaction. */
  recordUsage(entry: Omit<PromptUsageRecord, "id" | "usedAt">): PromptUsageRecord {
    const record: PromptUsageRecord = {
      ...entry,
      id: crypto.randomUUID(),
      usedAt: new Date(),
    };

    this.usageRecords.push(record);

    if (this.usageRecords.length > this.maxUsageRecords) {
      this.usageRecords.shift();
    }

    return record;
  }

  /**
   * Record the outcome score for a previous usage record.
   * Scores must be in [0, 1]; values outside this range are clamped.
   */
  recordOutcome(usageId: string, score: number): PromptOutcomeRecord {
    const usage = this.usageRecords.find((r) => r.id === usageId);
    if (!usage) {
      throw new Error(`Usage record '${usageId}' not found`);
    }

    const clamped = Math.max(0, Math.min(1, score));
    const record: PromptOutcomeRecord = {
      id: crypto.randomUUID(),
      usageId,
      templateKey: usage.templateKey,
      templateVersion: usage.templateVersion,
      score: clamped,
      recordedAt: new Date(),
    };

    this.outcomeRecords.push(record);
    return record;
  }

  /** Return aggregated statistics per template version. */
  getVersionStats(templateKey?: string): VersionStats[] {
    const usages = templateKey
      ? this.usageRecords.filter((r) => r.templateKey === templateKey)
      : this.usageRecords;

    const statsMap = new Map<string, VersionStats>();

    for (const u of usages) {
      const mapKey = `${u.templateKey}::${u.templateVersion}`;
      const existing = statsMap.get(mapKey) ?? {
        templateKey: u.templateKey,
        version: u.templateVersion,
        usageCount: 0,
        scoredCount: 0,
        meanScore: null,
      };
      existing.usageCount++;
      statsMap.set(mapKey, existing);
    }

    for (const o of this.outcomeRecords) {
      if (templateKey && o.templateKey !== templateKey) continue;
      const mapKey = `${o.templateKey}::${o.templateVersion}`;
      const existing = statsMap.get(mapKey);
      if (!existing) continue;

      const prev = existing.meanScore ?? 0;
      const prevCount = existing.scoredCount;
      existing.scoredCount++;
      // Running mean
      existing.meanScore = (prev * prevCount + o.score) / existing.scoredCount;
    }

    return [...statsMap.values()].sort((a, b) => {
      if (a.templateKey !== b.templateKey) return a.templateKey.localeCompare(b.templateKey);
      return a.version - b.version;
    });
  }

  /** Return usage records for a specific template key. */
  getUsageRecords(templateKey: string): PromptUsageRecord[] {
    return this.usageRecords.filter((r) => r.templateKey === templateKey);
  }

  /** Return outcome records for a specific template key. */
  getOutcomeRecords(templateKey: string): PromptOutcomeRecord[] {
    return this.outcomeRecords.filter((r) => r.templateKey === templateKey);
  }
}
