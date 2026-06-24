// V2-15: Unified API Gateway
export { ApiGateway } from "./api-gateway.js";
export type {
  RequestInterceptor,
  ResponseInterceptor,
  UsageRecord,
  ApiGatewayConfig,
} from "./api-gateway.js";

export { HttpBaseAdapter } from "./api-adapter.js";
export type {
  ApiRequest,
  ApiResponse,
  AdapterMeta,
  ApiAdapter,
  HttpAdapterConfig,
} from "./api-adapter.js";

export { CredentialManager } from "./credential-manager.js";
export type { CredentialRecord, CredentialManagerConfig } from "./credential-manager.js";

export { CircuitBreaker } from "./circuit-breaker.js";
export type { CircuitState, CircuitBreakerConfig, CircuitBreakerStats } from "./circuit-breaker.js";

// V2-16: Event-Driven Architecture
export { EventBus } from "./event-bus.js";
export type { EventHandler, Subscription, EventBusConfig } from "./event-bus.js";

export {
  EventSchemaRegistry,
  BaseEventSchema,
  ApiCallEventPayloadSchema,
  ErrorEventPayloadSchema,
} from "./event-schema.js";
export type {
  BaseEvent,
  TypedEvent,
  EventTypeEntry,
  ApiCallEventPayload,
  ErrorEventPayload,
} from "./event-schema.js";

export { EventStore } from "./event-store.js";
export type { EventStoreConfig, EventQuery, ProjectionReducer } from "./event-store.js";

export { DeadLetterQueue } from "./dead-letter-queue.js";
export type {
  DeadLetterEntry,
  DlqReplayHandler,
  DlqReplayResult,
  DlqReplayFailure,
  DlqRetryAllResult,
  DeadLetterQueueConfig,
} from "./dead-letter-queue.js";
