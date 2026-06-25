/**
 * Anomaly detector — V2-06.
 * Identifies unusual values in metric streams using statistical methods
 * (z-score and IQR fence). When a value is flagged as anomalous an alert
 * is routed through the AlertRouter and an InvestigationContext is assembled.
 */

import type { BaselineProfiler, BaselineStats } from "./baseline-profiler.js";
import type { AlertRouter, AlertSeverity } from "./alert-router.js";
import type { InvestigationContextBuilder, InvestigationContext } from "./investigation-context.js";

export interface AnomalyDetectorConfig {
  /**
   * Number of standard deviations from the mean that constitutes an anomaly
   * when using the z-score method. Default: 3.0 (3-sigma rule).
   */
  zScoreThreshold?: number;
  /**
   * IQR multiplier for the fence method (value > Q3 + k*IQR is anomalous).
   * Default: 1.5 (Tukey's fence).
   */
  iqrMultiplier?: number;
  /**
   * Which detection method(s) to use.
   * "zscore" | "iqr" | "both" — default "both".
   */
  method?: "zscore" | "iqr" | "both";
}

export interface DetectionResult {
  metric: string;
  value: number;
  isAnomaly: boolean;
  method?: "zscore" | "iqr";
  context?: InvestigationContext;
}

/**
 * Statistical anomaly detector.
 * Each call to `observe()` records the value in the baseline profiler and
 * checks whether it is anomalous. If so, an alert is emitted and an
 * investigation context is assembled.
 */
export class AnomalyDetector {
  private readonly zScoreThreshold: number;
  private readonly iqrMultiplier: number;
  private readonly method: "zscore" | "iqr" | "both";

  constructor(
    private readonly baselineProfiler: BaselineProfiler,
    private readonly alertRouter: AlertRouter,
    private readonly contextBuilder: InvestigationContextBuilder,
    config: AnomalyDetectorConfig = {}
  ) {
    this.zScoreThreshold = config.zScoreThreshold ?? 3.0;
    this.iqrMultiplier = config.iqrMultiplier ?? 1.5;
    this.method = config.method ?? "both";
  }

  /**
   * Observe a new metric value.
   * Records it in the baseline profiler, detects anomalies, and emits alerts.
   */
  async observe(metric: string, value: number): Promise<DetectionResult> {
    // Record in baseline and context builder before detection
    this.baselineProfiler.record(metric, value);
    this.contextBuilder.recordSample(metric, value);

    const baseline = this.baselineProfiler.getBaseline(metric);

    // Not enough data yet — not an anomaly
    if (!baseline) {
      return { metric, value, isAnomaly: false };
    }

    const zScoreAnomaly =
      (this.method === "zscore" || this.method === "both") &&
      baseline.stdDev > 0 &&
      Math.abs((value - baseline.mean) / baseline.stdDev) > this.zScoreThreshold;

    const iqrAnomaly =
      (this.method === "iqr" || this.method === "both") &&
      baseline.iqr > 0 &&
      (value > baseline.q3 + this.iqrMultiplier * baseline.iqr ||
        value < baseline.q1 - this.iqrMultiplier * baseline.iqr);

    const detectedByZScore = zScoreAnomaly && !iqrAnomaly;
    const detectedByIqr = iqrAnomaly && !zScoreAnomaly;
    const detectedByBoth = zScoreAnomaly && iqrAnomaly;
    const isAnomaly = zScoreAnomaly || iqrAnomaly;
    const detectionMethod: "zscore" | "iqr" | undefined = detectedByBoth
      ? "zscore" // prefer zscore label when both fire
      : detectedByZScore
        ? "zscore"
        : detectedByIqr
          ? "iqr"
          : undefined;

    if (!isAnomaly) {
      return { metric, value, isAnomaly: false };
    }

    const severity = this.classifySeverity(value, baseline.mean, baseline.stdDev);
    const deviation = baseline.stdDev > 0 ? (value - baseline.mean) / baseline.stdDev : 0;

    const alert = await this.alertRouter.emit({
      metric,
      severity,
      message: `Anomalous value ${value.toFixed(4)} detected (${deviation.toFixed(1)}σ from mean ${baseline.mean.toFixed(4)}) via ${detectionMethod ?? "combined"} method.`,
      value,
      threshold: this.getViolatedThreshold(value, baseline, iqrAnomaly),
    });

    const context = this.contextBuilder.build(alert, baseline);

    return { metric, value, isAnomaly: true, method: detectionMethod, context };
  }

  /**
   * Classify severity based on how many standard deviations the value is
   * from the baseline mean. Falls back to "medium" when stdDev is zero.
   */
  private classifySeverity(value: number, mean: number, stdDev: number): AlertSeverity {
    if (stdDev === 0) return "medium";
    const sigma = Math.abs((value - mean) / stdDev);
    if (sigma >= 6) return "critical";
    if (sigma >= 4.5) return "high";
    if (sigma >= 3) return "medium";
    return "low";
  }

  private getViolatedThreshold(
    value: number,
    baseline: BaselineStats,
    iqrAnomaly: boolean
  ): number {
    if (iqrAnomaly) {
      return value < baseline.q1
        ? baseline.q1 - this.iqrMultiplier * baseline.iqr
        : baseline.q3 + this.iqrMultiplier * baseline.iqr;
    }

    return value < baseline.mean
      ? baseline.mean - this.zScoreThreshold * baseline.stdDev
      : baseline.mean + this.zScoreThreshold * baseline.stdDev;
  }
}
