// V2-21: Cross-Agent Communication Protocol

// ── Message Schema ──────────────────────────────────────────────────────────
export { PROTOCOL_VERSION } from "./message-schema.js";
export type {
  MessageType,
  RouteHop,
  RoutingMetadata,
  MessageHeaders,
  RequestPayload,
  ResponsePayload,
  ResponseError,
  EventPayload,
  ProtocolErrorPayload,
  MessagePayload,
  AgentMessage,
  RequestMessage,
  ResponseMessage,
  EventMessage,
  ProtocolErrorMessage,
  CreateMessageOptions,
} from "./message-schema.js";
export {
  createRequestMessage,
  createResponseMessage,
  createEventMessage,
  createProtocolErrorMessage,
  isRequestMessage,
  isResponseMessage,
  isEventMessage,
  isProtocolErrorMessage,
} from "./message-schema.js";

// ── Protocol ────────────────────────────────────────────────────────────────
export type { SemVer, CompatibilityResult } from "./protocol.js";
export type { ProtocolErrorCodeValue } from "./protocol.js";
export {
  parseSemVer,
  compareSemVer,
  checkCompatibility,
  negotiateVersion,
  ProtocolErrorCode,
  SUPPORTED_VERSIONS,
  DEFAULT_TTL,
  MAX_TTL,
  DEFAULT_NAMESPACE,
  validateHeaders,
} from "./protocol.js";

// ── Handshake ───────────────────────────────────────────────────────────────
export type {
  HandshakeStep,
  HandshakePayload,
  SessionStatus,
  AgentSession,
  HandshakeManagerConfig,
} from "./handshake.js";
export { HandshakeError, HandshakeManager } from "./handshake.js";

// ── Context Serializer ──────────────────────────────────────────────────────
export type {
  SerializedMemoryEntry,
  SerializedMessage,
  TaskStateSnapshot,
  SerializedAgentContext,
  SerializeOptions,
} from "./context-serializer.js";
export { ContextSerializer } from "./context-serializer.js";

// ── Message Router ──────────────────────────────────────────────────────────
export type {
  AgentTransport,
  RouteEntry,
  RoutingOutcome,
  RoutingResult,
  MessageRouterConfig,
} from "./message-router.js";
export { TransportError, RouteTable, MessageRouter } from "./message-router.js";
