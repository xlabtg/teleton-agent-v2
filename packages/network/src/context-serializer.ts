/**
 * Context Serializer — V2-21.
 * Provides primitives for capturing, serializing, and restoring agent context
 * so that relevant state (memory, session, task progress) can be transferred
 * to a peer agent. The design is intentionally transport-agnostic: callers
 * serialize to a plain object and choose their own wire encoding (JSON, msgpack…).
 */

import type { AgentContext, MemoryEntry, Message } from "../../core/src/domain/agent.interface.js";
import { z } from "zod";

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

const MAX_DESERIALIZED_MESSAGES = 100;
const MAX_DESERIALIZED_MEMORY_ENTRIES = 200;
const MAX_TAGS_PER_MEMORY_ENTRY = 50;
const MAX_EMBEDDING_VALUES = 4096;
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const IsoDateStringSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "Expected an ISO-8601 date string",
});

const JsonLikeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonLikeSchema).max(100),
    z.record(JsonLikeSchema),
  ])
);

const MetadataSchema = z.record(JsonLikeSchema);

const SerializedMessageSchema = z
  .object({
    role: z.enum(["user", "assistant", "system", "tool"]),
    content: z.string(),
    timestamp: IsoDateStringSchema,
    metadata: MetadataSchema.optional(),
  })
  .strict();

const SerializedMemoryEntrySchema = z
  .object({
    id: z.string(),
    content: z.string(),
    importance: z.number().finite(),
    createdAt: IsoDateStringSchema,
    accessedAt: IsoDateStringSchema,
    tags: z.array(z.string()).max(MAX_TAGS_PER_MEMORY_ENTRY),
    embedding: z.array(z.number().finite()).max(MAX_EMBEDDING_VALUES).optional(),
  })
  .strict();

const TaskStateSnapshotSchema = z
  .object({
    taskId: z.string(),
    name: z.string(),
    state: MetadataSchema,
    snapshotAt: IsoDateStringSchema,
  })
  .strict();

const SerializedAgentContextSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    agentId: z.string(),
    sessionId: z.string(),
    userId: z.string(),
    capturedAt: IsoDateStringSchema,
    conversationHistory: z.array(SerializedMessageSchema).max(MAX_DESERIALIZED_MESSAGES),
    memory: z.array(SerializedMemoryEntrySchema).max(MAX_DESERIALIZED_MEMORY_ENTRIES),
    taskState: TaskStateSnapshotSchema.optional(),
    metadata: MetadataSchema,
  })
  .strict();

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
    const trustedSnapshot = validateSnapshot(snapshot);

    return {
      sessionId: trustedSnapshot.sessionId,
      userId: trustedSnapshot.userId,
      conversationHistory: trustedSnapshot.conversationHistory.map(deserializeMessage),
      memory: trustedSnapshot.memory.map(deserializeMemoryEntry),
      availableTools: [],
      timestamp: new Date(trustedSnapshot.capturedAt),
    };
  }

  /**
   * Merge a received snapshot into an existing local context.
   * Remote messages and memory entries are prepended so local history is preserved.
   * Duplicate messages (same role, timestamp, and content) and duplicate memory
   * entries (same id) are skipped, making repeated merges idempotent.
   */
  static merge(local: AgentContext, remote: SerializedAgentContext): AgentContext {
    const trustedRemote = validateSnapshot(remote);
    const remoteMessages = trustedRemote.conversationHistory.map(deserializeMessage);
    const remoteMemory = trustedRemote.memory.map(deserializeMemoryEntry);

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
    metadata: m.metadata ? sanitizeRecord(m.metadata) : undefined,
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

function validateSnapshot(snapshot: unknown): SerializedAgentContext {
  const result = SerializedAgentContextSchema.safeParse(snapshot);
  if (!result.success) {
    throw new Error(
      `Invalid serialized agent context: ${result.error.issues[0]?.message ?? "unknown error"}`
    );
  }

  return sanitizeSnapshot(result.data);
}

function sanitizeSnapshot(snapshot: SerializedAgentContext): SerializedAgentContext {
  return {
    ...snapshot,
    conversationHistory: snapshot.conversationHistory.map((message) => ({
      ...message,
      metadata: message.metadata ? sanitizeRecord(message.metadata) : undefined,
    })),
    memory: snapshot.memory.map((entry) => ({
      ...entry,
      tags: [...entry.tags],
      embedding: entry.embedding ? [...entry.embedding] : undefined,
    })),
    taskState: snapshot.taskState
      ? {
          ...snapshot.taskState,
          state: sanitizeRecord(snapshot.taskState.state),
        }
      : undefined,
    metadata: sanitizeRecord(snapshot.metadata),
  };
}

function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    if (UNSAFE_OBJECT_KEYS.has(key)) {
      continue;
    }
    sanitized[key] = sanitizeValue(value);
  }

  return sanitized;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === "object") {
    return sanitizeRecord(value as Record<string, unknown>);
  }
  return value;
}
