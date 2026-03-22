// V2-04: User Behavior Prediction Engine
export { BehaviorTracker } from "./behavior-tracker.js";
export type { BehavioralEvent, ActionType, BehaviorTrackerConfig } from "./behavior-tracker.js";
export { PatternMiner } from "./pattern-miner.js";
export type { ActionPattern, PatternMinerConfig } from "./pattern-miner.js";
export { PredictionEvaluator } from "./prediction-evaluator.js";
export type { PredictionRecord, EvaluationSummary } from "./prediction-evaluator.js";
export { PredictionEngine } from "./prediction-engine.js";
export type { Prediction, PredictionEngineConfig } from "./prediction-engine.js";

// V2-05: Predictive Response Caching
export { CacheKeyGenerator } from "./cache-key-generator.js";
export type { CacheKeyGeneratorConfig, CacheKeyEntry } from "./cache-key-generator.js";
export { CacheMetrics } from "./cache-metrics.js";
export type { CacheMetricsSnapshot } from "./cache-metrics.js";
export { CacheWarmer } from "./cache-warmer.js";
export type { CacheWarmerConfig, ResponseGenerator } from "./cache-warmer.js";
export { PredictiveCache } from "./predictive-cache.js";
export type { CacheEntry, PredictiveCacheConfig } from "./predictive-cache.js";

// V2-06: Anomaly Detection System
export { BaselineProfiler } from "./baseline-profiler.js";
export type { BaselineStats, BaselineProfilerConfig } from "./baseline-profiler.js";
export { AlertRouter } from "./alert-router.js";
export type { Alert, AlertSeverity, AlertHandler, AlertRouterConfig } from "./alert-router.js";
export { InvestigationContextBuilder } from "./investigation-context.js";
export type {
  MetricSample,
  InvestigationContext,
  InvestigationContextBuilderConfig,
} from "./investigation-context.js";
export { AnomalyDetector } from "./anomaly-detector.js";
export type { AnomalyDetectorConfig, DetectionResult } from "./anomaly-detector.js";
