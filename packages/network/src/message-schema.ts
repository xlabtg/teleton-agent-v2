/**
 * Message Schema — V2-21.
 * Defines the wire format for cross-agent messages: envelope, typed headers,
 * structured payload, and correlation tracking. Every message on the network
 * MUST conform to this schema.
 */

// ─── Protocol version ───────────────────────────────────────────────────────

/** Semantic version of the cross-agent protocol. */
export const PROTOCOL_VERSION = "1.0.0" as const;

// ─── Message types ───────────────────────────────────────────────────────────

/**
 * All top-level message type discriminants.
 * "request"   – caller expects a response.
 * "response"  – reply to a previous request (identified by correlationId).
 * "event"     – fire-and-forget notification.
 * "handshake" – protocol-level capability negotiation (see handshake.ts).
 * "error"     – protocol-level error not tied to application logic.
 */
export type MessageType = "request" | "response" | "event" | "handshake" | "error";

// ─── Routing metadata ────────────────────────────────────────────────────────

/**
 * Describes a single hop in the delivery path.
 * Each intermediary agent prepends itself to the hop list so the full route
 * can be reconstructed for audit and debugging.
 */
export interface RouteHop {
  /** Agent id that forwarded the message. */
  agentId: string;
  /** Wall-clock time at which the hop occurred (ISO-8601). */
  timestamp: string;
}

/**
 * Routing metadata carried in every message.
 * The sender fills in `source` and `destination`; routers append to `path`.
 */
export interface RoutingMetadata {
  /** Originating agent id. */
  source: string;
  /** Target agent id or broadcast token "*". */
  destination: string;
  /** Namespace scoping for multi-tenant environments. Default: "default". */
  namespace: string;
  /** Ordered list of agent ids the message should traverse (empty = direct). */
  via: string[];
  /** Accumulated delivery path, written by each hop. */
  path: RouteHop[];
  /** Remaining allowed hops before the message is dropped (TTL). */
  ttl: number;
}

// ─── Message headers ─────────────────────────────────────────────────────────

/**
 * Mandatory envelope headers present on every message.
 */
export interface MessageHeaders {
  /** Globally unique message identifier (UUID v4 recommended). */
  messageId: string;
  /** Type discriminant determining payload interpretation. */
  type: MessageType;
  /** Protocol version emitted by the sender ("major.minor.patch"). */
  protocolVersion: string;
  /** Message creation time (ISO-8601). */
  createdAt: string;
  /**
   * For "response" and "error" messages: id of the originating "request".
   * Must be absent or null for "event" and "handshake" messages.
   */
  correlationId?: string;
  /** Signature over (messageId + createdAt + payload) for authenticity checks. */
  signature?: string;
  /** Free-form key-value pairs for application-level metadata. */
  metadata: Record<string, string>;
}

// ─── Typed payloads ──────────────────────────────────────────────────────────

/** Payload for a "request" message. */
export interface RequestPayload {
  /** Name of the capability or action being invoked. */
  action: string;
  /** Arguments for the action; schema is action-specific. */
  args: Record<string, unknown>;
  /**
   * Maximum milliseconds the sender is willing to wait for a response.
   * 0 = fire-and-forget (no response expected).
   */
  timeoutMs: number;
}

/** Payload for a "response" message. */
export interface ResponsePayload {
  /** Whether the request completed successfully. */
  success: boolean;
  /** Result data when success=true. */
  result?: unknown;
  /** Error detail when success=false. */
  error?: ResponseError;
}

/** Structured error carried inside a ResponsePayload. */
export interface ResponseError {
  /** Machine-readable error code (e.g. "NOT_FOUND", "TIMEOUT"). */
  code: string;
  /** Human-readable description. */
  message: string;
  /** Additional context for debugging. */
  details?: Record<string, unknown>;
}

/** Payload for an "event" message. */
export interface EventPayload {
  /** Namespaced event name, e.g. "agent.task.completed". */
  eventType: string;
  /** Event data; schema is eventType-specific. */
  data: Record<string, unknown>;
}

/** Payload for a protocol-level "error" message. */
export interface ProtocolErrorPayload {
  /** Machine-readable error code. */
  code: string;
  /** Human-readable description. */
  message: string;
  /** Id of the offending message, if applicable. */
  offendingMessageId?: string;
}

/** Union of all possible payload types. */
export type MessagePayload = RequestPayload | ResponsePayload | EventPayload | ProtocolErrorPayload;

// ─── Message envelope ────────────────────────────────────────────────────────

/**
 * Top-level message envelope that travels over the wire.
 * Every cross-agent message is an instance of AgentMessage.
 */
export interface AgentMessage {
  headers: MessageHeaders;
  routing: RoutingMetadata;
  payload: MessagePayload;
}

// ─── Typed message helpers ───────────────────────────────────────────────────

/** AgentMessage with a RequestPayload. */
export interface RequestMessage extends AgentMessage {
  headers: MessageHeaders & { type: "request" };
  payload: RequestPayload;
}

/** AgentMessage with a ResponsePayload. */
export interface ResponseMessage extends AgentMessage {
  headers: MessageHeaders & { type: "response"; correlationId: string };
  payload: ResponsePayload;
}

/** AgentMessage with an EventPayload. */
export interface EventMessage extends AgentMessage {
  headers: MessageHeaders & { type: "event" };
  payload: EventPayload;
}

/** AgentMessage with a ProtocolErrorPayload. */
export interface ProtocolErrorMessage extends AgentMessage {
  headers: MessageHeaders & { type: "error" };
  payload: ProtocolErrorPayload;
}

// ─── Factory helpers ─────────────────────────────────────────────────────────

/** Options shared by all message factory functions. */
export interface CreateMessageOptions {
  source: string;
  destination: string;
  namespace?: string;
  via?: string[];
  ttl?: number;
  metadata?: Record<string, string>;
  signature?: string;
}

/** Generate a pseudo-random correlation id (not cryptographically secure). */
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build a RequestMessage with sensible defaults.
 */
export function createRequestMessage(
  opts: CreateMessageOptions & {
    action: string;
    args?: Record<string, unknown>;
    timeoutMs?: number;
  }
): RequestMessage {
  return {
    headers: {
      messageId: newId(),
      type: "request",
      protocolVersion: PROTOCOL_VERSION,
      createdAt: new Date().toISOString(),
      metadata: opts.metadata ?? {},
      signature: opts.signature,
    },
    routing: {
      source: opts.source,
      destination: opts.destination,
      namespace: opts.namespace ?? "default",
      via: opts.via ?? [],
      path: [],
      ttl: opts.ttl ?? 10,
    },
    payload: {
      action: opts.action,
      args: opts.args ?? {},
      timeoutMs: opts.timeoutMs ?? 30_000,
    },
  };
}

/**
 * Build a ResponseMessage correlated to an incoming RequestMessage.
 */
export function createResponseMessage(
  request: RequestMessage,
  result: { success: boolean; result?: unknown; error?: ResponseError }
): ResponseMessage {
  return {
    headers: {
      messageId: newId(),
      type: "response",
      protocolVersion: PROTOCOL_VERSION,
      createdAt: new Date().toISOString(),
      correlationId: request.headers.messageId,
      metadata: {},
    },
    routing: {
      source: request.routing.destination,
      destination: request.routing.source,
      namespace: request.routing.namespace,
      via: [],
      path: [],
      ttl: 10,
    },
    payload: {
      success: result.success,
      result: result.result,
      error: result.error,
    },
  };
}

/**
 * Build an EventMessage.
 */
export function createEventMessage(
  opts: CreateMessageOptions & { eventType: string; data?: Record<string, unknown> }
): EventMessage {
  return {
    headers: {
      messageId: newId(),
      type: "event",
      protocolVersion: PROTOCOL_VERSION,
      createdAt: new Date().toISOString(),
      metadata: opts.metadata ?? {},
      signature: opts.signature,
    },
    routing: {
      source: opts.source,
      destination: opts.destination,
      namespace: opts.namespace ?? "default",
      via: opts.via ?? [],
      path: [],
      ttl: opts.ttl ?? 10,
    },
    payload: {
      eventType: opts.eventType,
      data: opts.data ?? {},
    },
  };
}

/**
 * Build a ProtocolErrorMessage.
 */
export function createProtocolErrorMessage(
  opts: CreateMessageOptions & {
    code: string;
    message: string;
    offendingMessageId?: string;
  }
): ProtocolErrorMessage {
  return {
    headers: {
      messageId: newId(),
      type: "error",
      protocolVersion: PROTOCOL_VERSION,
      createdAt: new Date().toISOString(),
      metadata: opts.metadata ?? {},
    },
    routing: {
      source: opts.source,
      destination: opts.destination,
      namespace: opts.namespace ?? "default",
      via: [],
      path: [],
      ttl: 5,
    },
    payload: {
      code: opts.code,
      message: opts.message,
      offendingMessageId: opts.offendingMessageId,
    },
  };
}

// ─── Type guards ─────────────────────────────────────────────────────────────

export function isRequestMessage(msg: AgentMessage): msg is RequestMessage {
  return msg.headers.type === "request";
}

export function isResponseMessage(msg: AgentMessage): msg is ResponseMessage {
  return msg.headers.type === "response";
}

export function isEventMessage(msg: AgentMessage): msg is EventMessage {
  return msg.headers.type === "event";
}

export function isProtocolErrorMessage(msg: AgentMessage): msg is ProtocolErrorMessage {
  return msg.headers.type === "error";
}
