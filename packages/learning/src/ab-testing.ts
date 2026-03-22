/**
 * A/B testing framework — V2-19.
 * Supports traffic splitting between strategy variants and tracks per-variant
 * outcome metrics so that statistical significance can be evaluated before
 * promoting a winner.
 *
 * The splitter is deterministic per user-id: the same user always sees the
 * same variant within an active experiment, which prevents confusing UX
 * caused by switching variants mid-session.
 */

export interface Variant {
  /** Unique key within the experiment (e.g. "control", "treatment_a"). */
  key: string;
  /** Fraction of traffic this variant should receive (0–1). All variant
   *  weights in an experiment must sum to 1. */
  weight: number;
  /** Opaque payload that callers use to apply the variant (e.g. strategy id). */
  payload: Record<string, unknown>;
}

export type ExperimentStatus = "running" | "paused" | "concluded";

export interface Experiment {
  id: string;
  name: string;
  description: string;
  variants: Variant[];
  status: ExperimentStatus;
  createdAt: Date;
  concludedAt?: Date;
  /** Variant key that won (set when the experiment is concluded). */
  winner?: string;
}

export interface ExposureRecord {
  experimentId: string;
  userId: string;
  variantKey: string;
  exposedAt: Date;
}

export interface OutcomeRecord {
  experimentId: string;
  userId: string;
  variantKey: string;
  /** True = positive outcome (e.g. thumbs_up), false = negative. */
  positive: boolean;
  recordedAt: Date;
}

export interface VariantStats {
  variantKey: string;
  exposures: number;
  positiveOutcomes: number;
  negativeOutcomes: number;
  /** Conversion rate: positiveOutcomes / (positiveOutcomes + negativeOutcomes).
   *  0 if no outcomes recorded yet. */
  conversionRate: number;
}

export interface ExperimentResults {
  experimentId: string;
  variantStats: VariantStats[];
  /** True when the leading variant has at least minDeltaForSignificance advantage. */
  hasSignificantWinner: boolean;
  leadingVariantKey: string | null;
}

export interface AbTestingConfig {
  /**
   * Minimum conversion-rate delta required between the best and second-best
   * variant to declare a significant winner.
   */
  minDeltaForSignificance?: number;
}

/** Deterministic bucket assignment: maps (experimentId, userId) → [0, 1). */
function deterministicBucket(experimentId: string, userId: string): number {
  // Simple but reproducible: sum char codes modulo a large prime, normalise.
  const key = `${experimentId}::${userId}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0; // unsigned 32-bit
  }
  return hash / 0x1_0000_0000; // normalise to [0, 1)
}

/**
 * A/B testing manager.
 *
 * Experiments are stored in-memory.  The assignment algorithm is
 * deterministic so that logs can be replayed without re-assigning users.
 */
export class AbTesting {
  private readonly experiments = new Map<string, Experiment>();
  private readonly exposures: ExposureRecord[] = [];
  private readonly outcomes: OutcomeRecord[] = [];
  private readonly minDelta: number;

  constructor(config: AbTestingConfig = {}) {
    this.minDelta = config.minDeltaForSignificance ?? 0.05;
  }

  /** Create a new experiment. Validates that variant weights sum to 1. */
  createExperiment(experiment: Omit<Experiment, "id" | "createdAt" | "status">): Experiment {
    const totalWeight = experiment.variants.reduce((s, v) => s + v.weight, 0);
    if (Math.abs(totalWeight - 1) > 1e-6) {
      throw new Error(`Variant weights must sum to 1, got ${totalWeight.toFixed(4)}`);
    }

    const stored: Experiment = {
      ...experiment,
      id: crypto.randomUUID(),
      status: "running",
      createdAt: new Date(),
    };
    this.experiments.set(stored.id, stored);
    return stored;
  }

  /**
   * Assign a user to a variant for a running experiment.
   * The assignment is deterministic and idempotent: calling this multiple
   * times with the same arguments always returns the same variant.
   *
   * Records an exposure only on the first call per (experiment, user) pair.
   */
  assignVariant(experimentId: string, userId: string): Variant {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) throw new Error(`Experiment '${experimentId}' not found`);
    if (experiment.status !== "running") {
      throw new Error(`Experiment '${experimentId}' is not running (status: ${experiment.status})`);
    }

    const bucket = deterministicBucket(experimentId, userId);
    let cumulative = 0;
    let assigned: Variant | undefined;
    for (const variant of experiment.variants) {
      cumulative += variant.weight;
      if (bucket < cumulative) {
        assigned = variant;
        break;
      }
    }
    // Fallback to last variant in case of floating-point imprecision
    assigned ??= experiment.variants[experiment.variants.length - 1];

    // Record exposure only if this is the first time this user is assigned
    const alreadyExposed = this.exposures.some(
      (e) => e.experimentId === experimentId && e.userId === userId
    );
    if (!alreadyExposed) {
      this.exposures.push({
        experimentId,
        userId,
        variantKey: assigned.key,
        exposedAt: new Date(),
      });
    }

    return assigned;
  }

  /** Record an outcome for a user in a given experiment. */
  recordOutcome(experimentId: string, userId: string, positive: boolean): void {
    const exposure = this.exposures.find(
      (e) => e.experimentId === experimentId && e.userId === userId
    );
    if (!exposure) {
      throw new Error(`No exposure found for user '${userId}' in experiment '${experimentId}'`);
    }

    this.outcomes.push({
      experimentId,
      userId,
      variantKey: exposure.variantKey,
      positive,
      recordedAt: new Date(),
    });
  }

  /** Compute per-variant statistics for an experiment. */
  getResults(experimentId: string): ExperimentResults {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) throw new Error(`Experiment '${experimentId}' not found`);

    const statsMap = new Map<string, VariantStats>();
    for (const variant of experiment.variants) {
      statsMap.set(variant.key, {
        variantKey: variant.key,
        exposures: 0,
        positiveOutcomes: 0,
        negativeOutcomes: 0,
        conversionRate: 0,
      });
    }

    for (const e of this.exposures.filter((e) => e.experimentId === experimentId)) {
      const s = statsMap.get(e.variantKey);
      if (s) s.exposures++;
    }

    for (const o of this.outcomes.filter((o) => o.experimentId === experimentId)) {
      const s = statsMap.get(o.variantKey);
      if (!s) continue;
      if (o.positive) s.positiveOutcomes++;
      else s.negativeOutcomes++;
    }

    for (const s of statsMap.values()) {
      const total = s.positiveOutcomes + s.negativeOutcomes;
      s.conversionRate = total > 0 ? s.positiveOutcomes / total : 0;
    }

    const statsList = [...statsMap.values()].sort((a, b) => b.conversionRate - a.conversionRate);

    const leadingVariantKey = statsList.length > 0 ? statsList[0].variantKey : null;
    const hasSignificantWinner =
      statsList.length >= 2 &&
      statsList[0].conversionRate - statsList[1].conversionRate >= this.minDelta;

    return {
      experimentId,
      variantStats: statsList,
      hasSignificantWinner,
      leadingVariantKey,
    };
  }

  /** Pause a running experiment (stops new assignments). */
  pauseExperiment(experimentId: string): void {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment '${experimentId}' not found`);
    exp.status = "paused";
  }

  /** Resume a paused experiment. */
  resumeExperiment(experimentId: string): void {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment '${experimentId}' not found`);
    exp.status = "running";
  }

  /** Conclude an experiment, recording the winner. */
  concludeExperiment(experimentId: string, winnerKey: string): void {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment '${experimentId}' not found`);
    if (!exp.variants.some((v) => v.key === winnerKey)) {
      throw new Error(`Variant '${winnerKey}' not found in experiment '${experimentId}'`);
    }
    exp.status = "concluded";
    exp.winner = winnerKey;
    exp.concludedAt = new Date();
  }

  getExperiment(id: string): Experiment | undefined {
    return this.experiments.get(id);
  }

  listExperiments(): Experiment[] {
    return [...this.experiments.values()];
  }

  getExposures(experimentId: string): ExposureRecord[] {
    return this.exposures.filter((e) => e.experimentId === experimentId);
  }
}
