/**
 * Baseline profiler.
 * Computes statistical baselines (mean, standard deviation, IQR) for
 * numerical metrics using a sliding window of historical observations.
 * These baselines are consumed by the anomaly detector.
 */

export interface BaselineStats {
  mean: number;
  stdDev: number;
  /** First quartile (25th percentile). */
  q1: number;
  median: number;
  /** Third quartile (75th percentile). */
  q3: number;
  /** Inter-quartile range = q3 - q1. */
  iqr: number;
  sampleCount: number;
}

export interface BaselineProfilerConfig {
  /** Maximum number of observations retained per metric (sliding window). */
  windowSize?: number;
}

/**
 * Maintains per-metric sliding windows and computes statistical baselines.
 */
export class BaselineProfiler {
  private readonly observations = new Map<string, number[]>();
  private readonly windowSize: number;

  constructor(config: BaselineProfilerConfig = {}) {
    this.windowSize = config.windowSize ?? 200;
  }

  /**
   * Record a new observation for a named metric.
   */
  record(metric: string, value: number): void {
    const window = this.observations.get(metric) ?? [];
    window.push(value);

    if (window.length > this.windowSize) {
      window.splice(0, window.length - this.windowSize);
    }

    this.observations.set(metric, window);
  }

  /**
   * Record multiple observations at once.
   */
  recordBatch(metric: string, values: number[]): void {
    for (const v of values) {
      this.record(metric, v);
    }
  }

  /**
   * Return the current baseline statistics for a metric.
   * Returns null if fewer than 2 observations have been recorded.
   */
  getBaseline(metric: string): BaselineStats | null {
    const window = this.observations.get(metric);
    if (!window || window.length < 2) return null;

    const sorted = [...window].sort((a, b) => a - b);
    const n = sorted.length;

    const mean = sorted.reduce((s, v) => s + v, 0) / n;
    const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);

    const q1 = percentile(sorted, 25);
    const median = percentile(sorted, 50);
    const q3 = percentile(sorted, 75);

    return {
      mean,
      stdDev,
      q1,
      median,
      q3,
      iqr: q3 - q1,
      sampleCount: n,
    };
  }

  /**
   * Return all metric names being tracked.
   */
  getMetrics(): string[] {
    return Array.from(this.observations.keys());
  }

  /**
   * Remove all observations for a metric.
   */
  clear(metric: string): void {
    this.observations.delete(metric);
  }
}

/**
 * Compute the p-th percentile of a sorted numeric array (linear interpolation).
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const frac = idx - lower;

  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}
