/**
 * Investigation context builder.
 * Packages relevant diagnostic data around an anomaly alert to give
 * reviewers the full picture without having to hunt through logs manually.
 */

import type { Alert } from "./alert-router.js";
import type { BaselineStats } from "./baseline-profiler.js";

export interface MetricSample {
  timestamp: Date;
  value: number;
}

export interface InvestigationContext {
  alert: Alert;
  baseline: BaselineStats | null;
  /** Recent metric samples leading up to the anomaly. */
  recentSamples: MetricSample[];
  /** z-score of the anomalous value relative to the baseline. */
  zScore: number | null;
  /** Human-readable summary of the anomaly. */
  summary: string;
  assembledAt: Date;
}

export interface InvestigationContextBuilderConfig {
  /** Number of recent samples to include in the context. */
  sampleLookback?: number;
}

/**
 * Assembles investigation context for an alert by combining the alert data
 * with baseline statistics and recent metric samples.
 */
export class InvestigationContextBuilder {
  private readonly sampleLookback: number;
  /** Sample store: metric name → ordered list of (timestamp, value) pairs. */
  private readonly samples = new Map<string, MetricSample[]>();

  constructor(config: InvestigationContextBuilderConfig = {}) {
    this.sampleLookback = config.sampleLookback ?? 20;
  }

  /**
   * Record a metric sample so it can be included in future investigation contexts.
   */
  recordSample(metric: string, value: number, timestamp: Date = new Date()): void {
    const list = this.samples.get(metric) ?? [];
    list.push({ timestamp, value });
    // Keep only recent samples to bound memory usage
    if (list.length > this.sampleLookback * 2) {
      list.splice(0, list.length - this.sampleLookback * 2);
    }
    this.samples.set(metric, list);
  }

  /**
   * Build an investigation context for an alert.
   */
  build(alert: Alert, baseline: BaselineStats | null): InvestigationContext {
    const recentSamples = (this.samples.get(alert.metric) ?? []).slice(-this.sampleLookback);

    const zScore =
      baseline && baseline.stdDev > 0 ? (alert.value - baseline.mean) / baseline.stdDev : null;

    const summary = this.buildSummary(alert, baseline, zScore);

    return {
      alert,
      baseline,
      recentSamples,
      zScore,
      summary,
      assembledAt: new Date(),
    };
  }

  private buildSummary(
    alert: Alert,
    baseline: BaselineStats | null,
    zScore: number | null
  ): string {
    const parts: string[] = [
      `[${alert.severity.toUpperCase()}] Anomaly on metric "${alert.metric}".`,
      `Observed value: ${alert.value.toFixed(4)}.`,
    ];

    if (baseline) {
      parts.push(
        `Baseline mean: ${baseline.mean.toFixed(4)}, ` +
          `stdDev: ${baseline.stdDev.toFixed(4)} (${baseline.sampleCount} samples).`
      );
    }

    if (zScore !== null) {
      parts.push(`z-score: ${zScore.toFixed(2)}.`);
    }

    parts.push(alert.message);
    return parts.join(" ");
  }
}
