/**
 * Repository port interfaces.
 * Infrastructure layer implements these to provide data access.
 */

import type { MemoryEntry, Task, TaskResult } from "../domain/agent.interface.js";
import type { DomainEvent } from "../domain/events.js";

export interface MemoryRepository {
  store(entry: Omit<MemoryEntry, "id">): Promise<MemoryEntry>;
  findById(id: string): Promise<MemoryEntry | null>;
  search(query: string, limit?: number): Promise<MemoryEntry[]>;
  searchByEmbedding(embedding: number[], limit?: number): Promise<MemoryEntry[]>;
  update(id: string, updates: Partial<MemoryEntry>): Promise<MemoryEntry>;
  delete(id: string): Promise<void>;
  compact(maxAge: Date): Promise<number>;
}

export interface TaskRepository {
  create(task: Omit<Task, "id" | "createdAt" | "status">): Promise<Task>;
  findById(id: string): Promise<Task | null>;
  findByStatus(status: Task["status"]): Promise<Task[]>;
  findPending(limit?: number): Promise<Task[]>;
  update(id: string, updates: Partial<Task>): Promise<Task>;
  storeResult(result: TaskResult): Promise<void>;
  getResult(taskId: string): Promise<TaskResult | null>;
}

export interface SessionRepository {
  create(userId: string): Promise<{ id: string; userId: string; createdAt: Date }>;
  findById(id: string): Promise<{ id: string; userId: string; createdAt: Date } | null>;
  findByUser(userId: string): Promise<{ id: string; userId: string; createdAt: Date }[]>;
  end(id: string): Promise<void>;
}

export interface EventRepository {
  store(event: DomainEvent): Promise<void>;
  findByType(type: string, limit?: number): Promise<DomainEvent[]>;
  findBySource(source: string, limit?: number): Promise<DomainEvent[]>;
  findInRange(from: Date, to: Date): Promise<DomainEvent[]>;
}
