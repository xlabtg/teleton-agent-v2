// V2-07: Agent Registration and Discovery
export type {
  AgentStatus,
  AgentCapabilityDescriptor,
  AgentDescriptor,
  RegisterAgentInput,
} from "./agent-descriptor.js";
export { AgentRegistry } from "./agent-registry.js";
export type { AgentRegistryConfig } from "./agent-registry.js";
export { DiscoveryService } from "./discovery-service.js";
export type { CapabilityQuery, DiscoveryResult } from "./discovery-service.js";
export { HealthChecker } from "./health-checker.js";
export type { HealthCheckerConfig, HealthProbe } from "./health-checker.js";

// V2-08: Intelligent Task Delegation
export type { SubTask, DecomposedTask, DecompositionStrategy } from "./task-decomposer.js";
export { TaskDecomposer } from "./task-decomposer.js";
export type { TaskDecomposerConfig } from "./task-decomposer.js";
export type { MatchResult } from "./capability-matcher.js";
export { CapabilityMatcher } from "./capability-matcher.js";
export type { CapabilityMatcherConfig } from "./capability-matcher.js";
export type { RoutingStrategy, RoutingDecision } from "./delegation-router.js";
export { DelegationRouter } from "./delegation-router.js";
export type { DelegationRouterConfig } from "./delegation-router.js";
export type { SubTaskStatus, SubTaskResult, AggregatedResult } from "./result-aggregator.js";
export { ResultAggregator } from "./result-aggregator.js";
export type { ResultAggregatorConfig } from "./result-aggregator.js";

// V2-09: Multi-Step Execution Pipeline
export type {
  PipelineStatus,
  StepStatus,
  StepDefinition,
  RetryPolicy,
  StepState,
  PipelineState,
} from "./pipeline-state.js";
export { validatePipelineTransition } from "./pipeline-state.js";
export type { CheckpointEntry, CheckpointStore } from "./checkpoint-store.js";
export { InMemoryCheckpointStore } from "./checkpoint-store.js";
export type { RollbackResult } from "./rollback-handler.js";
export { RollbackHandler } from "./rollback-handler.js";
export type {
  StepExecutor,
  ProgressCallback,
  PipelineDefinition,
  ExecutionPipelineConfig,
} from "./execution-pipeline.js";
export { ExecutionPipeline } from "./execution-pipeline.js";

// V2-10: Self-Correcting Execution Loop
export type { ErrorCategory, ClassificationResult } from "./error-classifier.js";
export { ErrorClassifier } from "./error-classifier.js";
export type {
  CorrectionContext,
  CorrectionResult,
  CorrectionStrategy,
} from "./correction-strategies.js";
export {
  backoffStrategy,
  rateLimitStrategy,
  validationStrategy,
  notFoundStrategy,
  CorrectionStrategyRegistry,
} from "./correction-strategies.js";
export type { CorrectionRecord } from "./correction-history.js";
export { CorrectionHistory } from "./correction-history.js";
export type { CorrectionHistoryConfig } from "./correction-history.js";
export type { OperationFn, SelfCorrectionConfig, SelfCorrectionResult } from "./self-correction.js";
export { SelfCorrection } from "./self-correction.js";
