/**
 * Tests for SQLite repository implementations.
 * Uses in-memory databases (':memory:') for isolation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SQLiteConnection,
  SQLiteMemoryRepository,
  SQLiteTaskRepository,
  SQLiteSessionRepository,
  SQLiteEventRepository,
} from "../../packages/infrastructure/src/database/sqlite.adapter.js";
import type {
  MemoryEntry,
  Task,
  TaskResult,
} from "../../packages/core/src/domain/agent.interface.js";
import type { DomainEvent } from "../../packages/core/src/domain/events.js";

// ---------------------------------------------------------------------------
// SQLiteMemoryRepository
// ---------------------------------------------------------------------------

describe("SQLiteMemoryRepository", () => {
  let repo: SQLiteMemoryRepository;

  const makeEntry = (
    overrides: Partial<Omit<MemoryEntry, "id">> = {}
  ): Omit<MemoryEntry, "id"> => ({
    content: "default content",
    importance: 0.5,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    accessedAt: new Date("2024-01-01T00:00:00Z"),
    tags: ["tag1"],
    ...overrides,
  });

  beforeEach(() => {
    repo = new SQLiteMemoryRepository(":memory:");
  });

  // -- store & findById ------------------------------------------------------

  it("should store and retrieve an entry by id", async () => {
    const entry = await repo.store(makeEntry({ content: "hello world" }));
    expect(entry.id).toBeDefined();
    expect(typeof entry.id).toBe("string");

    const found = await repo.findById(entry.id);
    expect(found).not.toBeNull();
    expect(found!.content).toBe("hello world");
    expect(found!.importance).toBe(0.5);
    expect(found!.tags).toEqual(["tag1"]);
  });

  it("should return null for a non-existent id", async () => {
    const result = await repo.findById("does-not-exist");
    expect(result).toBeNull();
  });

  it("should list entries without using full-text search", async () => {
    await repo.store(makeEntry({ content: "oldest", createdAt: new Date("2024-01-01T00:00:00Z") }));
    await repo.store(makeEntry({ content: "newest", createdAt: new Date("2024-01-03T00:00:00Z") }));
    await repo.store(makeEntry({ content: "middle", createdAt: new Date("2024-01-02T00:00:00Z") }));

    const results = await repo.list(2);

    expect(results.map((entry) => entry.content)).toEqual(["newest", "middle"]);
  });

  it("should persist createdAt and accessedAt timestamps", async () => {
    const created = new Date("2024-03-15T10:00:00Z");
    const accessed = new Date("2024-03-15T11:00:00Z");
    const entry = await repo.store(makeEntry({ createdAt: created, accessedAt: accessed }));
    const found = await repo.findById(entry.id);
    expect(found!.createdAt.toISOString()).toBe(created.toISOString());
    expect(found!.accessedAt.toISOString()).toBe(accessed.toISOString());
  });

  // -- search (FTS5) ---------------------------------------------------------

  it("should find entries via full-text search", async () => {
    await repo.store(makeEntry({ content: "SQLite vector search tutorial" }));
    await repo.store(makeEntry({ content: "Completely unrelated dog pictures" }));

    const results = await repo.search("vector");
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("SQLite vector search tutorial");
  });

  it("should return empty array when search finds nothing", async () => {
    await repo.store(makeEntry({ content: "hello world" }));
    const results = await repo.search("zzznomatch");
    expect(results).toEqual([]);
  });

  it.each(["", "   \n\t"])(
    "should return empty array for empty keyword search without invoking FTS (%j)",
    async (query) => {
      await repo.store(makeEntry({ content: "hello world" }));

      await expect(repo.search(query)).resolves.toEqual([]);
    }
  );

  it("should respect the limit parameter in search", async () => {
    for (let i = 0; i < 5; i++) {
      await repo.store(makeEntry({ content: `repeating keyword entry ${i}` }));
    }
    const results = await repo.search("repeating keyword", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  // -- searchByEmbedding (sqlite-vec) ----------------------------------------

  it("should find entries by vector similarity", async () => {
    const e1 = await repo.store(makeEntry({ content: "near vector", embedding: [1, 0, 0, 0] }));
    const e2 = await repo.store(makeEntry({ content: "far vector", embedding: [0, 1, 0, 0] }));

    const results = await repo.searchByEmbedding([1, 0, 0, 0], 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // The first result should be the closest entry
    expect(results[0].id).toBe(e1.id);
    expect(results[0].score).toBeCloseTo(1);
    expect(results[0].vectorScore).toBe(results[0].score);
    // The far entry should come after
    if (results.length > 1) {
      expect(results[1].id).toBe(e2.id);
      expect(results[1].score).toBeLessThan(results[0].score!);
      expect(results[1].vectorScore).toBe(results[1].score);
    }
  });

  it("should return empty array for empty embedding", async () => {
    await repo.store(makeEntry({ content: "something" }));
    const results = await repo.searchByEmbedding([], 5);
    expect(results).toEqual([]);
  });

  it("should not include entries without embeddings in vector search", async () => {
    await repo.store(makeEntry({ content: "no embedding" })); // no embedding
    await repo.store(makeEntry({ content: "has embedding", embedding: [0.5, 0.5] }));

    const results = await repo.searchByEmbedding([0.5, 0.5], 10);
    expect(results.every((r) => r.content !== "no embedding")).toBe(true);
  });

  it("should reject embedding dimension changes without dropping existing vectors", async () => {
    const entry = await repo.store(makeEntry({ content: "kept vector", embedding: [1, 0] }));

    await expect(
      repo.store(makeEntry({ content: "wrong dimension", embedding: [1, 0, 0] }))
    ).rejects.toThrow(/memory_vec embedding dimension mismatch/i);

    const results = await repo.searchByEmbedding([1, 0], 10);
    expect(results.map((result) => result.id)).toContain(entry.id);
  });

  it.each([
    [384, 38],
    [128, 12],
  ])(
    "should reject prefix-colliding embedding dimensions without dropping existing vectors (%i vs %i)",
    async (storedDim, requestedDim) => {
      const embedding = Array.from({ length: storedDim }, (_, index) => (index === 0 ? 1 : 0));
      const entry = await repo.store(makeEntry({ content: "kept vector", embedding }));

      await expect(
        repo.store({
          ...makeEntry({ content: "prefix-colliding dimension" }),
          embedding: Array.from({ length: requestedDim }, (_, index) => (index === 0 ? 1 : 0)),
        })
      ).rejects.toThrow(/memory_vec embedding dimension mismatch/i);

      const results = await repo.searchByEmbedding(embedding, 10);
      expect(results.map((result) => result.id)).toContain(entry.id);
    }
  );

  // -- update ----------------------------------------------------------------

  it("should update an existing entry", async () => {
    const entry = await repo.store(makeEntry({ content: "original" }));
    const updated = await repo.update(entry.id, { content: "updated", importance: 0.9 });
    expect(updated.content).toBe("updated");
    expect(updated.importance).toBe(0.9);

    const found = await repo.findById(entry.id);
    expect(found!.content).toBe("updated");
  });

  it("should throw when updating a non-existent entry", async () => {
    await expect(repo.update("ghost-id", { content: "x" })).rejects.toThrow();
  });

  // -- delete ----------------------------------------------------------------

  it("should delete an entry", async () => {
    const entry = await repo.store(makeEntry());
    await repo.delete(entry.id);
    const found = await repo.findById(entry.id);
    expect(found).toBeNull();
  });

  it("should be idempotent on delete for non-existent id", async () => {
    await expect(repo.delete("non-existent")).resolves.toBeUndefined();
  });

  // -- compact ---------------------------------------------------------------

  it("should compact entries older than maxAge", async () => {
    const old = new Date("2020-01-01T00:00:00Z");
    const recent = new Date("2024-01-01T00:00:00Z");

    await repo.store(makeEntry({ accessedAt: old }));
    await repo.store(makeEntry({ accessedAt: recent }));

    const count = await repo.compact(new Date("2023-01-01T00:00:00Z"));
    expect(count).toBe(1);
  });

  it("should close the underlying database connection", async () => {
    repo.close();

    await expect(repo.store(makeEntry())).rejects.toThrow(/closed|not open/i);
  });
});

describe("SQLite repositories shared connection", () => {
  it("should configure a busy timeout for contended writes", () => {
    const connection = new SQLiteConnection(":memory:");

    expect(connection.database.pragma("busy_timeout", { simple: true })).toBe(
      SQLiteConnection.BUSY_TIMEOUT_MS
    );

    connection.close();
  });

  it("should reuse one SQLite connection across repository instances", async () => {
    const connection = new SQLiteConnection(":memory:");
    const memoryRepo = new SQLiteMemoryRepository(connection);
    const taskRepo = new SQLiteTaskRepository(connection);

    await memoryRepo.store({
      content: "shared connection memory",
      importance: 0.5,
      createdAt: new Date("2024-01-01T00:00:00Z"),
      accessedAt: new Date("2024-01-01T00:00:00Z"),
      tags: ["shared"],
    });
    const task = await taskRepo.create({
      name: "shared-connection-task",
      payload: {},
      priority: { level: "normal", weight: 1 },
    });

    expect(await memoryRepo.search("shared")).toHaveLength(1);
    expect(await taskRepo.findById(task.id)).not.toBeNull();

    memoryRepo.close();

    await expect(taskRepo.findById(task.id)).rejects.toThrow(/closed|not open/i);
  });
});

// ---------------------------------------------------------------------------
// SQLiteTaskRepository
// ---------------------------------------------------------------------------

describe("SQLiteTaskRepository", () => {
  let repo: SQLiteTaskRepository;

  const makeTask = (
    overrides: Partial<Omit<Task, "id" | "createdAt" | "status">> = {}
  ): Omit<Task, "id" | "createdAt" | "status"> => ({
    name: "test-task",
    payload: { key: "value" },
    priority: { level: "normal", weight: 1 },
    ...overrides,
  });

  beforeEach(() => {
    repo = new SQLiteTaskRepository(":memory:");
  });

  // -- create & findById -----------------------------------------------------

  it("should create and retrieve a task", async () => {
    const task = await repo.create(makeTask({ name: "my-task" }));
    expect(task.id).toBeDefined();
    expect(task.status).toBe("pending");
    expect(task.createdAt).toBeInstanceOf(Date);

    const found = await repo.findById(task.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("my-task");
    expect(found!.payload).toEqual({ key: "value" });
  });

  it("should return null for unknown task id", async () => {
    const result = await repo.findById("unknown");
    expect(result).toBeNull();
  });

  it("should persist priority and deadline", async () => {
    const deadline = new Date("2025-12-31T00:00:00Z");
    const task = await repo.create(
      makeTask({ priority: { level: "critical", weight: 10 }, deadline })
    );
    const found = await repo.findById(task.id);
    expect(found!.priority).toEqual({ level: "critical", weight: 10 });
    expect(found!.deadline!.toISOString()).toBe(deadline.toISOString());
  });

  // -- findByStatus ----------------------------------------------------------

  it("should find tasks by status", async () => {
    await repo.create(makeTask({ name: "task-a" }));
    await repo.create(makeTask({ name: "task-b" }));

    const pending = await repo.findByStatus("pending");
    expect(pending).toHaveLength(2);

    // Update one to 'completed'
    await repo.update(pending[0].id, { status: "completed" });
    const remaining = await repo.findByStatus("pending");
    expect(remaining).toHaveLength(1);
  });

  // -- findPending -----------------------------------------------------------

  it("should return pending tasks up to the limit", async () => {
    for (let i = 0; i < 5; i++) {
      await repo.create(makeTask({ name: `task-${i}` }));
    }
    const tasks = await repo.findPending(3);
    expect(tasks).toHaveLength(3);
    expect(tasks.every((t) => t.status === "pending")).toBe(true);
  });

  // -- update ----------------------------------------------------------------

  it("should update task status and fields", async () => {
    const task = await repo.create(makeTask());
    const updated = await repo.update(task.id, { status: "in_progress", assignedAgent: "agent-1" });
    expect(updated.status).toBe("in_progress");
    expect(updated.assignedAgent).toBe("agent-1");

    const found = await repo.findById(task.id);
    expect(found!.status).toBe("in_progress");
  });

  it("should throw when updating a non-existent task", async () => {
    await expect(repo.update("ghost", { status: "completed" })).rejects.toThrow();
  });

  // -- storeResult & getResult -----------------------------------------------

  it("should store and retrieve a task result", async () => {
    const task = await repo.create(makeTask());
    const result: TaskResult = {
      taskId: task.id,
      success: true,
      output: { answer: 42 },
      executionTime: 123.4,
      agentId: "agent-1",
    };
    await repo.storeResult(result);

    const found = await repo.getResult(task.id);
    expect(found).not.toBeNull();
    expect(found!.success).toBe(true);
    expect(found!.output).toEqual({ answer: 42 });
    expect(found!.executionTime).toBe(123.4);
    expect(found!.agentId).toBe("agent-1");
  });

  it("should return null for unknown task result", async () => {
    const result = await repo.getResult("unknown-task");
    expect(result).toBeNull();
  });

  it("should overwrite existing result with storeResult", async () => {
    const task = await repo.create(makeTask());
    await repo.storeResult({
      taskId: task.id,
      success: false,
      output: null,
      executionTime: 1,
      agentId: "a",
    });
    await repo.storeResult({
      taskId: task.id,
      success: true,
      output: { done: true },
      executionTime: 2,
      agentId: "b",
    });

    const found = await repo.getResult(task.id);
    expect(found!.success).toBe(true);
    expect(found!.agentId).toBe("b");
  });

  it("should persist error message in failed result", async () => {
    const task = await repo.create(makeTask());
    await repo.storeResult({
      taskId: task.id,
      success: false,
      output: null,
      error: "timeout exceeded",
      executionTime: 0,
      agentId: "agent-1",
    });

    const found = await repo.getResult(task.id);
    expect(found!.success).toBe(false);
    expect(found!.error).toBe("timeout exceeded");
  });
});

// ---------------------------------------------------------------------------
// SQLiteSessionRepository
// ---------------------------------------------------------------------------

describe("SQLiteSessionRepository", () => {
  let repo: SQLiteSessionRepository;

  beforeEach(() => {
    repo = new SQLiteSessionRepository(":memory:");
  });

  // -- create & findById -----------------------------------------------------

  it("should create and retrieve a session", async () => {
    const session = await repo.create("user-1");
    expect(session.id).toBeDefined();
    expect(session.userId).toBe("user-1");
    expect(session.createdAt).toBeInstanceOf(Date);

    const found = await repo.findById(session.id);
    expect(found).not.toBeNull();
    expect(found!.userId).toBe("user-1");
  });

  it("should return null for unknown session id", async () => {
    const result = await repo.findById("unknown");
    expect(result).toBeNull();
  });

  // -- findByUser ------------------------------------------------------------

  it("should find active sessions by user", async () => {
    await repo.create("user-1");
    await repo.create("user-1");
    await repo.create("user-2");

    const user1Sessions = await repo.findByUser("user-1");
    expect(user1Sessions).toHaveLength(2);
    expect(user1Sessions.every((s) => s.userId === "user-1")).toBe(true);

    const user2Sessions = await repo.findByUser("user-2");
    expect(user2Sessions).toHaveLength(1);
  });

  it("should return empty array for user with no sessions", async () => {
    const result = await repo.findByUser("ghost-user");
    expect(result).toEqual([]);
  });

  // -- end -------------------------------------------------------------------

  it("should end a session (make it invisible to find)", async () => {
    const session = await repo.create("user-1");
    await repo.end(session.id);

    const found = await repo.findById(session.id);
    expect(found).toBeNull();

    const sessions = await repo.findByUser("user-1");
    expect(sessions).toHaveLength(0);
  });

  it("should be idempotent when ending the same session twice", async () => {
    const session = await repo.create("user-1");
    await repo.end(session.id);
    await expect(repo.end(session.id)).resolves.toBeUndefined();
  });

  it("should not affect other sessions when ending one", async () => {
    const s1 = await repo.create("user-1");
    const s2 = await repo.create("user-1");

    await repo.end(s1.id);

    const active = await repo.findByUser("user-1");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(s2.id);
  });
});

// ---------------------------------------------------------------------------
// SQLiteEventRepository
// ---------------------------------------------------------------------------

describe("SQLiteEventRepository", () => {
  let repo: SQLiteEventRepository;

  const makeEvent = (overrides: Partial<DomainEvent> = {}): DomainEvent => ({
    id: crypto.randomUUID(),
    type: "test.event",
    timestamp: new Date("2024-06-01T12:00:00Z"),
    payload: { data: 1 },
    source: "test-source",
    ...overrides,
  });

  beforeEach(() => {
    repo = new SQLiteEventRepository(":memory:");
  });

  // -- store & findByType ----------------------------------------------------

  it("should store events and find them by type", async () => {
    await repo.store(makeEvent({ type: "agent.started" }));
    await repo.store(makeEvent({ type: "agent.started" }));
    await repo.store(makeEvent({ type: "task.created" }));

    const started = await repo.findByType("agent.started");
    expect(started).toHaveLength(2);
    expect(started.every((e) => e.type === "agent.started")).toBe(true);

    const created = await repo.findByType("task.created");
    expect(created).toHaveLength(1);
  });

  it("should return empty array for unknown type", async () => {
    const results = await repo.findByType("unknown.type");
    expect(results).toEqual([]);
  });

  it("should respect limit in findByType", async () => {
    for (let i = 0; i < 10; i++) {
      await repo.store(makeEvent({ id: crypto.randomUUID(), type: "repeated.event" }));
    }
    const results = await repo.findByType("repeated.event", 5);
    expect(results).toHaveLength(5);
  });

  // -- findBySource ----------------------------------------------------------

  it("should find events by source", async () => {
    await repo.store(makeEvent({ source: "agent-1" }));
    await repo.store(makeEvent({ source: "agent-1" }));
    await repo.store(makeEvent({ source: "agent-2" }));

    const from1 = await repo.findBySource("agent-1");
    expect(from1).toHaveLength(2);

    const from2 = await repo.findBySource("agent-2");
    expect(from2).toHaveLength(1);
  });

  // -- findInRange -----------------------------------------------------------

  it("should find events within a time range", async () => {
    const t1 = new Date("2024-01-01T00:00:00Z");
    const t2 = new Date("2024-06-01T00:00:00Z");
    const t3 = new Date("2024-12-01T00:00:00Z");

    await repo.store(makeEvent({ id: crypto.randomUUID(), timestamp: t1 }));
    await repo.store(makeEvent({ id: crypto.randomUUID(), timestamp: t2 }));
    await repo.store(makeEvent({ id: crypto.randomUUID(), timestamp: t3 }));

    const inRange = await repo.findInRange(
      new Date("2024-02-01T00:00:00Z"),
      new Date("2024-09-01T00:00:00Z")
    );
    expect(inRange).toHaveLength(1);
    expect(inRange[0].timestamp.toISOString()).toBe(t2.toISOString());
  });

  it("should return empty array for range with no events", async () => {
    await repo.store(makeEvent({ timestamp: new Date("2024-01-01T00:00:00Z") }));
    const results = await repo.findInRange(
      new Date("2025-01-01T00:00:00Z"),
      new Date("2025-12-31T00:00:00Z")
    );
    expect(results).toEqual([]);
  });

  it("should persist event payload correctly", async () => {
    const event = makeEvent({ payload: { nested: { value: 42 }, list: [1, 2, 3] } });
    await repo.store(event);

    const found = await repo.findByType(event.type);
    expect(found[0].payload).toEqual({ nested: { value: 42 }, list: [1, 2, 3] });
  });

  it("should order findByType results by timestamp descending", async () => {
    const early = makeEvent({
      id: crypto.randomUUID(),
      timestamp: new Date("2024-01-01T00:00:00Z"),
    });
    const late = makeEvent({
      id: crypto.randomUUID(),
      timestamp: new Date("2024-12-01T00:00:00Z"),
    });

    await repo.store(early);
    await repo.store(late);

    const results = await repo.findByType("test.event");
    expect(results[0].id).toBe(late.id);
    expect(results[1].id).toBe(early.id);
  });
});
