/**
 * SQLite database adapter.
 * Provides memory and task storage with vector search support.
 *
 * Note: dbPath constructor parameters are stored for future use
 * when better-sqlite3 integration is completed.
 */

import type {
  MemoryRepository,
  TaskRepository,
  SessionRepository,
  EventRepository,
} from "@teleton/core/ports/repository.port.js";
import type { MemoryEntry, Task, TaskResult } from "@teleton/core/domain/agent.interface.js";
import type { DomainEvent } from "@teleton/core/domain/events.js";

/**
 * SQLite-based memory repository.
 * Uses better-sqlite3 with sqlite-vec for vector search.
 */
export class SQLiteMemoryRepository implements MemoryRepository {
  // Database instance will be injected via constructor
  // Using 'any' here as the actual better-sqlite3 types are injected at runtime
  constructor(protected readonly dbPath: string) {}

  async store(entry: Omit<MemoryEntry, "id">): Promise<MemoryEntry> {
    const id = crypto.randomUUID();
    // TODO: Implement with better-sqlite3
    return { id, ...entry };
  }

  async findById(_id: string): Promise<MemoryEntry | null> {
    // TODO: Implement with better-sqlite3
    return null;
  }

  async search(_query: string, _limit: number = 10): Promise<MemoryEntry[]> {
    // TODO: Implement FTS5 full-text search
    return [];
  }

  async searchByEmbedding(_embedding: number[], _limit: number = 10): Promise<MemoryEntry[]> {
    // TODO: Implement with sqlite-vec vector similarity search
    return [];
  }

  async update(id: string, _updates: Partial<MemoryEntry>): Promise<MemoryEntry> {
    // TODO: Implement with better-sqlite3
    throw new Error(`Memory entry '${id}' not found`);
  }

  async delete(_id: string): Promise<void> {
    // TODO: Implement with better-sqlite3
  }

  async compact(_maxAge: Date): Promise<number> {
    // TODO: Implement memory compaction
    return 0;
  }
}

/**
 * SQLite-based task repository.
 */
export class SQLiteTaskRepository implements TaskRepository {
  constructor(protected readonly dbPath: string) {}

  async create(task: Omit<Task, "id" | "createdAt" | "status">): Promise<Task> {
    const id = crypto.randomUUID();
    return {
      id,
      ...task,
      createdAt: new Date(),
      status: "pending",
    };
  }

  async findById(_id: string): Promise<Task | null> {
    return null;
  }

  async findByStatus(_status: Task["status"]): Promise<Task[]> {
    return [];
  }

  async findPending(_limit: number = 10): Promise<Task[]> {
    return [];
  }

  async update(id: string, _updates: Partial<Task>): Promise<Task> {
    throw new Error(`Task '${id}' not found`);
  }

  async storeResult(_result: TaskResult): Promise<void> {
    // TODO: Implement
  }

  async getResult(_taskId: string): Promise<TaskResult | null> {
    return null;
  }
}

/**
 * SQLite-based session repository.
 */
export class SQLiteSessionRepository implements SessionRepository {
  constructor(protected readonly dbPath: string) {}

  async create(userId: string): Promise<{ id: string; userId: string; createdAt: Date }> {
    return {
      id: crypto.randomUUID(),
      userId,
      createdAt: new Date(),
    };
  }

  async findById(_id: string): Promise<{ id: string; userId: string; createdAt: Date } | null> {
    return null;
  }

  async findByUser(_userId: string): Promise<{ id: string; userId: string; createdAt: Date }[]> {
    return [];
  }

  async end(_id: string): Promise<void> {
    // TODO: Implement
  }
}

/**
 * SQLite-based event repository for audit logging.
 */
export class SQLiteEventRepository implements EventRepository {
  constructor(protected readonly dbPath: string) {}

  async store(_event: DomainEvent): Promise<void> {
    // TODO: Implement
  }

  async findByType(_type: string, _limit: number = 100): Promise<DomainEvent[]> {
    return [];
  }

  async findBySource(_source: string, _limit: number = 100): Promise<DomainEvent[]> {
    return [];
  }

  async findInRange(_from: Date, _to: Date): Promise<DomainEvent[]> {
    return [];
  }
}
