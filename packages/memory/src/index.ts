// V2-01: Semantic Vector Memory
export { InMemoryVectorStore, cosineSimilarity } from "./vector-store.js";
export type {
  VectorStore,
  VectorEntry,
  VectorSearchResult,
  VectorStoreOptions,
} from "./vector-store.js";
export { CachedEmbeddingProvider } from "./embedding-provider.js";
export type { CachedEmbeddingProviderOptions } from "./embedding-provider.js";
export { SemanticSearch } from "./semantic-search.js";
export type { SemanticSearchOptions, SemanticSearchResult } from "./semantic-search.js";
export { HybridRetrieval } from "./hybrid-retrieval.js";
export type { HybridRetrievalOptions, HybridSearchResult } from "./hybrid-retrieval.js";

// V2-02: Associative Graph Memory
export { InMemoryGraphStore } from "./graph-store.js";
export type { GraphStore, GraphNode, GraphEdge, NodeType, EdgeType } from "./graph-store.js";
export { PatternEntityExtractor, LLMEntityExtractor } from "./entity-extractor.js";
export type {
  EntityExtractor,
  ExtractedEntity,
  ExtractedRelation,
  ExtractionResult,
} from "./entity-extractor.js";
export { GraphQuery } from "./graph-query.js";
export type { TraversalOptions, SubgraphResult, PathResult } from "./graph-query.js";
export { GraphMaintenance } from "./graph-maintenance.js";
export type { MaintenanceOptions, MaintenanceReport } from "./graph-maintenance.js";

// V2-03: Importance-Based Memory Retention
export { ImportanceScorer } from "./importance-scorer.js";
export type { ImportanceWeights, ScoringContext } from "./importance-scorer.js";
export { RetentionPolicy } from "./retention-policy.js";
export type {
  RetentionPolicyConfig,
  RetentionTier,
  RetentionThresholds,
  TierClassification,
} from "./retention-policy.js";
export { MemoryCompaction } from "./compaction.js";
export type { CompactionConfig, CompactionResult, SummaryFunction } from "./compaction.js";
export { MemoryManager } from "./memory-manager.js";
export type {
  MemoryManagerConfig,
  StoreOptions,
  SearchOptions,
  EnrichedSearchResult,
} from "./memory-manager.js";
