// Domain
export type {
  IAgent,
  AgentRole,
  Capability,
  Constraint,
  AgentContext,
  Message,
  MemoryEntry,
  ToolDefinition,
  Thought,
  Action,
  ActionResult,
  Observation,
  Task,
  TaskPriority,
  TaskResult,
} from "./domain/agent.interface.js";
export type {
  DomainEvent,
  AgentEventType,
  AgentEvent,
  EventHandler,
  EventBus,
} from "./domain/events.js";

// Errors
export {
  DomainError,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  ForbiddenError,
  RateLimitError,
  ConfigurationError,
  InfrastructureError,
  AgentExecutionError,
} from "./errors/domain-errors.js";

// Ports
export type {
  MemoryRepository,
  TaskRepository,
  SessionRepository,
  EventRepository,
} from "./ports/repository.port.js";
export type {
  LLMProvider,
  LLMChatOptions,
  LLMResponse,
  LLMToolCall,
  LLMStreamChunk,
  TelegramBridge,
  IncomingMessage,
  TonWallet,
  SecretsProvider,
  EmbeddingProvider,
} from "./ports/service.port.js";
export type { AppConfig, CradleInterface, AppContainer } from "./ports/di.container.js";
export { createAppContainer, registerAdapter } from "./ports/di.container.js";

// Use Cases
export { AgentRuntime } from "./usecases/agent-runtime.js";
export type { AgentRuntimeConfig, ToolExecutor } from "./usecases/agent-runtime.js";
export { AgentOrchestrator } from "./usecases/agent-orchestrator.js";
