// V2-19: Feedback-Based Learning
export { FeedbackCollector } from "./feedback-collector.js";
export type {
  ExplicitRating,
  ImplicitSignalType,
  ExplicitFeedbackEvent,
  ImplicitFeedbackEvent,
  FeedbackPayload,
  FeedbackEntry,
  FeedbackCollectorConfig,
} from "./feedback-collector.js";

export { FeedbackAnalyzer } from "./feedback-analyzer.js";
export type {
  CategoryStats,
  AgentStats,
  FeedbackTrend,
  FeedbackReport,
  FeedbackAnalyzerConfig,
} from "./feedback-analyzer.js";

export { StrategyAdjuster } from "./strategy-adjuster.js";
export type {
  ToolPreference,
  PromptOverride,
  ToolPreferenceOverride,
  RoutingHint,
  Strategy,
  StrategyAdjustment,
  StrategyAdjusterConfig,
} from "./strategy-adjuster.js";

export { AbTesting } from "./ab-testing.js";
export type {
  Variant,
  ExperimentStatus,
  Experiment,
  ExposureRecord,
  OutcomeRecord,
  VariantStats,
  ExperimentResults,
  AbTestingConfig,
} from "./ab-testing.js";

// V2-20: Dynamic Prompt Optimization
export { PromptRegistry } from "./prompt-registry.js";
export type { PromptVersion, PromptTemplate, PromptRegistryConfig } from "./prompt-registry.js";

export { PromptComposer } from "./prompt-composer.js";
export type {
  CompositionSection,
  CompositionConfig,
  ComposedPrompt,
  PromptComposerConfig,
} from "./prompt-composer.js";

export { PromptTracker } from "./prompt-tracker.js";
export type {
  PromptUsageRecord,
  PromptOutcomeRecord,
  VersionStats,
  PromptTrackerConfig,
} from "./prompt-tracker.js";

export { PromptOptimizer } from "./prompt-optimizer.js";
export type {
  OptimizationResult,
  OptimizationRun,
  PromptOptimizerConfig,
} from "./prompt-optimizer.js";
