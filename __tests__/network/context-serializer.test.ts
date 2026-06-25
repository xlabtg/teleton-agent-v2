import { describe, it, expect } from "vitest";
import { ContextSerializer } from "../../packages/network/src/context-serializer.js";
import type { AgentContext, MemoryEntry } from "../../packages/core/src/domain/agent.interface.js";
import type { SerializeOptions } from "../../packages/network/src/context-serializer.js";

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  const now = new Date("2024-01-01T00:00:00Z");
  return {
    sessionId: "session-1",
    userId: "user-42",
    conversationHistory: [
      { role: "user", content: "Hello", timestamp: now, metadata: {} },
      { role: "assistant", content: "Hi there", timestamp: now },
    ],
    memory: [
      {
        id: "mem-1",
        content: "User prefers concise answers",
        embedding: [0.1, 0.2, 0.3],
        importance: 0.9,
        createdAt: now,
        accessedAt: now,
        tags: ["preference"],
      },
      {
        id: "mem-2",
        content: "User works in finance",
        importance: 0.5,
        createdAt: now,
        accessedAt: now,
        tags: ["background"],
      },
    ],
    availableTools: [],
    timestamp: now,
    ...overrides,
  };
}

describe("ContextSerializer", () => {
  describe("serialize", () => {
    it("should produce a serialized snapshot with correct fields", () => {
      const serializer = new ContextSerializer("agent-a");
      const ctx = makeContext();
      const snapshot = serializer.serialize(ctx);

      expect(snapshot.schemaVersion).toBe("1.0");
      expect(snapshot.agentId).toBe("agent-a");
      expect(snapshot.sessionId).toBe("session-1");
      expect(snapshot.userId).toBe("user-42");
      expect(snapshot.capturedAt).toBeTruthy();
      expect(snapshot.conversationHistory.length).toBe(2);
      expect(snapshot.memory.length).toBe(2);
    });

    it("should serialize timestamps as ISO strings", () => {
      const serializer = new ContextSerializer("agent-a");
      const snapshot = serializer.serialize(makeContext());
      expect(() => new Date(snapshot.conversationHistory[0].timestamp)).not.toThrow();
      expect(() => new Date(snapshot.memory[0].createdAt)).not.toThrow();
    });

    it("should exclude embedding vectors by default", () => {
      const serializer = new ContextSerializer("agent-a");
      const snapshot = serializer.serialize(makeContext());
      expect(snapshot.memory[0].embedding).toBeUndefined();
    });

    it("should include embedding vectors when includeEmbeddings=true", () => {
      const serializer = new ContextSerializer("agent-a");
      const snapshot = serializer.serialize(makeContext(), { includeEmbeddings: true });
      expect(snapshot.memory[0].embedding).toEqual([0.1, 0.2, 0.3]);
    });

    it("should respect maxMessages limit", () => {
      const ctx = makeContext();
      const serializer = new ContextSerializer("agent-a");
      const opts: SerializeOptions = { maxMessages: 1 };
      const snapshot = serializer.serialize(ctx, opts);
      expect(snapshot.conversationHistory.length).toBe(1);
      // should keep the most recent message
      expect(snapshot.conversationHistory[0].content).toBe("Hi there");
    });

    it("should filter memory by minImportance", () => {
      const serializer = new ContextSerializer("agent-a");
      const snapshot = serializer.serialize(makeContext(), { minImportance: 0.7 });
      expect(snapshot.memory.length).toBe(1);
      expect(snapshot.memory[0].id).toBe("mem-1");
    });

    it("should respect maxMemoryEntries limit", () => {
      const serializer = new ContextSerializer("agent-a");
      const snapshot = serializer.serialize(makeContext(), { maxMemoryEntries: 1 });
      // sorted by importance descending, so mem-1 (0.9) should win
      expect(snapshot.memory.length).toBe(1);
      expect(snapshot.memory[0].id).toBe("mem-1");
    });

    it("should attach custom metadata and taskState", () => {
      const serializer = new ContextSerializer("agent-a");
      const taskState = {
        taskId: "task-1",
        name: "Analyze",
        state: { step: 2 },
        snapshotAt: new Date().toISOString(),
      };
      const snapshot = serializer.serialize(makeContext(), {
        metadata: { handoffReason: "specialised" },
        taskState,
      });
      expect(snapshot.metadata.handoffReason).toBe("specialised");
      expect(snapshot.taskState?.taskId).toBe("task-1");
    });
  });

  describe("deserialize", () => {
    it("should reconstruct an AgentContext from a snapshot", () => {
      const serializer = new ContextSerializer("agent-a");
      const ctx = makeContext();
      const snapshot = serializer.serialize(ctx);
      const restored = ContextSerializer.deserialize(snapshot);

      expect(restored.sessionId).toBe("session-1");
      expect(restored.userId).toBe("user-42");
      expect(restored.conversationHistory.length).toBe(2);
      expect(restored.conversationHistory[0].timestamp).toBeInstanceOf(Date);
      expect(restored.memory.length).toBe(2);
      expect(restored.memory[0].createdAt).toBeInstanceOf(Date);
      expect(restored.availableTools).toEqual([]);
    });
  });

  describe("merge", () => {
    it("should prepend remote messages to local history", () => {
      const now = new Date();
      const local = makeContext();
      const remote: MemoryEntry[] = [
        {
          id: "mem-remote-1",
          content: "Remote memory",
          importance: 0.8,
          createdAt: now,
          accessedAt: now,
          tags: [],
        },
      ];
      const remoteCtx = makeContext({
        sessionId: "session-remote",
        conversationHistory: [{ role: "user", content: "Remote message", timestamp: now }],
        memory: remote,
      });
      const remoteSerializer = new ContextSerializer("agent-b");
      const remoteSnapshot = remoteSerializer.serialize(remoteCtx);

      const merged = ContextSerializer.merge(local, remoteSnapshot);

      // Remote messages come first
      expect(merged.conversationHistory[0].content).toBe("Remote message");
      // Local messages are still there
      expect(merged.conversationHistory.some((m) => m.content === "Hello")).toBe(true);
      // Remote memory was added
      expect(merged.memory.some((m) => m.id === "mem-remote-1")).toBe(true);
    });

    it("should not duplicate memory entries", () => {
      const local = makeContext();
      const remoteSerializer = new ContextSerializer("agent-b");
      const remoteCtx = makeContext(); // same memory ids
      const remoteSnapshot = remoteSerializer.serialize(remoteCtx);

      const merged = ContextSerializer.merge(local, remoteSnapshot);
      const ids = merged.memory.map((m) => m.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it("should not duplicate conversation messages when merging the same snapshot twice", () => {
      const local = makeContext();
      const remoteSerializer = new ContextSerializer("agent-b");
      const remoteSnapshot = remoteSerializer.serialize(makeContext());

      const mergedOnce = ContextSerializer.merge(local, remoteSnapshot);
      const mergedTwice = ContextSerializer.merge(mergedOnce, remoteSnapshot);

      expect(mergedTwice.conversationHistory).toEqual(mergedOnce.conversationHistory);
    });

    it("should skip remote messages already present in local history", () => {
      const timestamp = new Date("2024-01-01T00:00:00Z");
      const local = makeContext({
        conversationHistory: [
          { role: "user", content: "Shared message", timestamp },
          { role: "assistant", content: "Local reply", timestamp },
        ],
      });
      const remoteCtx = makeContext({
        conversationHistory: [
          { role: "user", content: "Remote-only message", timestamp },
          { role: "user", content: "Shared message", timestamp },
        ],
      });
      const remoteSnapshot = new ContextSerializer("agent-b").serialize(remoteCtx);

      const merged = ContextSerializer.merge(local, remoteSnapshot);

      expect(merged.conversationHistory.map((m) => m.content)).toEqual([
        "Remote-only message",
        "Shared message",
        "Local reply",
      ]);
    });
  });
});
