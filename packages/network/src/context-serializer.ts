/**
 * Context Serializer — V2-21.
 * Provides primitives for capturing, serializing, and restoring agent context
 * so that relevant state (memory, session, task progress) can be transferred
 * to a peer agent. The design is intentionally transport-agnostic: callers
 * serialize to a plain object and choose their own wire encoding (JSON, msgpack…).
 */

import type { AgentContext, MemoryEntry, Message } from "../../core/src/domain/agent.interface.js";

// ─── Serialized types ─────────────────────────────────────────────────────────

/**
 * A compact, serializable snapshot of a MemoryEntry.
 * Embedding vectors are omitted by default to keep the payload small.
 */
export interface SerializedMemoryEntry {
  id: string;
  content: string;
  importance: number;
  createdAt: string;
  accessedAt: string;
  tags: string[];
  /** Only included when includeEmbeddings=true was passed to serialize. */
  embedding?: number[];
}

/**
 * A serializable representation of a conversation message.
 */
export interface SerializedMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * Serializable snapshot of task-specific state that can be shared with a peer.
 */
export interface TaskStateSnapshot {
  /** Unique task identifier. */
  taskId: string;
  /** Human-readable task name. */
  name: string;
  /** Arbitrary task-specific state data. */
  state: Record<string, unknown>;
  /** ISO-8601 timestamp of when the snapshot was taken. */
  snapshotAt: string;
}

/**
 * The complete serializable agent context snapshot.
 * This is what travels over the wire.
 */
export interface SerializedAgentContext {
  /** Schema version for forward compatibility. */
  schemaVersion: "1.0";
  /** Origin agent id. */
  agentId: string;
  /** Session the context belongs to. */
  sessionId: string;
  /** User id associated with this context. */
  userId: string;
  /** ISO-8601 capture time. */
  capturedAt: string;
  /** Subset of the conversation history included in this snapshot. */
  conversationHistory: SerializedMessage[];
  /** Memory entries selected for sharing. */
  memory: SerializedMemoryEntry[];
  /** Optional task state snapshot. */
  taskState?: TaskStateSnapshot;
  /** Free-form metadata (e.g. handoff reason, routing hints). */
  metadata: Record<string, unknown>;
}

// ─── Serialization options ────────────────────────────────────────────────────

export interface SerializeOptions {
  /** Maximum number of recent messages to include. Default: 20. */
  maxMessages?: number;
  /** Maximum number of memory entries to include. Default: 50. */
  maxMemoryEntries?: number;
  /** Include embedding vectors in serialized memory entries. Default: false. */
  includeEmbeddings?: boolean;
  /** Minimum importance score for a memory entry to be included. Default: 0. */
  minImportance?: number;
  /** Extra metadata to attach to the snapshot. */
  metadata?: Record<string, unknown>;
  /** Task state to embed in the snapshot. */
  taskState?: TaskStateSnapshot;
}

// ─── ContextSerializer ────────────────────────────────────────────────────────

/**
 * Utility class for converting AgentContext to and from wire-safe snapshots.
 *
 * Example:
 *   const serializer = new ContextSerializer({ agentId: "agent-a" });
 *   const snapshot = serializer.serialize(ctx, { maxMessages: 10 });
 *   // … embed snapshot in a RequestMessage payload and send it …
 *   // On the receiving end:
 *   const restoredCtx = ContextSerializer.deserialize(snapshot);
 */
export class ContextSerializer {
  private readonly agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  /**
   * Capture a snapshot of the given AgentContext.
   */
  serialize(ctx: AgentContext, opts: SerializeOptions = {}): SerializedAgentContext {
    const {
      maxMessages = 20,
      maxMemoryEntries = 50,
      includeEmbeddings = false,
      minImportance = 0,
      metadata = {},
      taskState,
    } = opts;

    const messages = ctx.conversationHistory.slice(-maxMessages).map((m) => serializeMessage(m));

    const memory = ctx.memory
      .filter((e) => e.importance >= minImportance)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, maxMemoryEntries)
      .map((e) => serializeMemoryEntry(e, includeEmbeddings));

    return {
      schemaVersion: "1.0",
      agentId: this.agentId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      capturedAt: new Date().toISOString(),
      conversationHistory: messages,
      memory,
      taskState,
      metadata,
    };
  }

  /**
   * Reconstruct an AgentContext from a snapshot.
   * The restored context will have empty availableTools — the receiving agent
   * must populate these based on its own capabilities.
   */
  static deserialize(snapshot: SerializedAgentContext): AgentContext {
    return {
      sessionId: snapshot.sessionId,
      userId: snapshot.userId,
      conversationHistory: snapshot.conversationHistory.map(deserializeMessage),
      memory: snapshot.memory.map(deserializeMemoryEntry),
      availableTools: [],
      timestamp: new Date(snapshot.capturedAt),
    };
  }

  /**
   * Merge a received snapshot into an existing local context.
   * Remote messages and memory entries are prepended so local history is preserved.
   * Duplicate messages (same role, timestamp, and content) and duplicate memory
   * entries (same id) are skipped, making repeated merges idempotent.
   */
  static merge(local: AgentContext, remote: SerializedAgentContext): AgentContext {
    const remoteMessages = remote.conversationHistory.map(deserializeMessage);
    const remoteMemory = remote.memory.map(deserializeMemoryEntry);

    const localMessageKeys = new Set(local.conversationHistory.map(messageDedupKey));
    const newMessages = remoteMessages.filter((m) => !localMessageKeys.has(messageDedupKey(m)));

    const localMemoryIds = new Set(local.memory.map((m) => m.id));
    const newMemory = remoteMemory.filter((m) => !localMemoryIds.has(m.id));

    return {
      ...local,
      conversationHistory: [...newMessages, ...local.conversationHistory],
      memory: [...newMemory, ...local.memory],
    };
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function serializeMessage(m: Message): SerializedMessage {
  return {
    role: m.role,
    content: m.content,
    timestamp: m.timestamp.toISOString(),
    metadata: m.metadata,
  };
}

function deserializeMessage(m: SerializedMessage): Message {
  return {
    role: m.role,
    content: m.content,
    timestamp: new Date(m.timestamp),
    metadata: m.metadata,
  };
}

function messageDedupKey(m: Message): string {
  return JSON.stringify([m.role, m.timestamp.toISOString(), m.content]);
}

function serializeMemoryEntry(e: MemoryEntry, includeEmbeddings: boolean): SerializedMemoryEntry {
  return {
    id: e.id,
    content: e.content,
    importance: e.importance,
    createdAt: e.createdAt.toISOString(),
    accessedAt: e.accessedAt.toISOString(),
    tags: [...e.tags],
    embedding: includeEmbeddings ? e.embedding : undefined,
  };
}

function deserializeMemoryEntry(e: SerializedMemoryEntry): MemoryEntry {
  return {
    id: e.id,
    content: e.content,
    importance: e.importance,
    createdAt: new Date(e.createdAt),
    accessedAt: new Date(e.accessedAt),
    tags: [...e.tags],
    embedding: e.embedding,
  };
}
