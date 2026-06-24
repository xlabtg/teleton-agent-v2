/**
 * SQLite database adapter.
 * Provides memory, task, session, and event storage with vector search support.
 *
 * Uses better-sqlite3 for synchronous SQLite access, FTS5 for full-text search,
 * and sqlite-vec for vector similarity search.
 */

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type {
  MemoryRepository,
  TaskRepository,
  SessionRepository,
  EventRepository,
} from "@teleton/core/ports/repository.port.js";
import type { MemoryEntry, Task, TaskResult } from "@teleton/core/domain/agent.interface.js";
import type { DomainEvent } from "@teleton/core/domain/events.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Serialize a float[] embedding to a raw little-endian Buffer for sqlite-vec.
 */
function serializeEmbedding(vec: number[]): Buffer {
  return Buffer.from(new Float32Array(vec).buffer);
}

// ---------------------------------------------------------------------------
// Base class — shared DB initialisation
// ---------------------------------------------------------------------------

class SQLiteBase {
  protected readonly db: Database.Database;
  private readonly connection: SQLiteConnection;

  constructor(connection: SQLiteConnection | string) {
    this.connection =
      typeof connection === "string" ? new SQLiteConnection(connection) : connection;
    this.db = this.connection.database;
  }

  close(): void {
    this.connection.close();
  }
}

export class SQLiteConnection {
  static readonly BUSY_TIMEOUT_MS = 5_000;

  readonly database: Database.Database;
  private closed = false;

  constructor(dbPath: string) {
    this.database = new Database(dbPath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma(`busy_timeout = ${SQLiteConnection.BUSY_TIMEOUT_MS}`);
    this.database.pragma("foreign_keys = ON");
    sqliteVec.load(this.database);
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.database.close();
    this.closed = true;
  }
}

// ---------------------------------------------------------------------------
// SQLiteMemoryRepository
// ---------------------------------------------------------------------------

/**
 * SQLite-backed memory repository.
 *
 * Schema:
 *   memory_entries — primary storage (rowid INTEGER PK)
 *   memory_entries_fts — FTS5 full-text index over content + tags
 *   memory_vec — sqlite-vec virtual table for vector similarity search
 */
export class SQLiteMemoryRepository extends SQLiteBase implements MemoryRepository {
  constructor(connection: SQLiteConnection | string) {
    super(connection);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        rowid    INTEGER PRIMARY KEY AUTOINCREMENT,
        id       TEXT    UNIQUE NOT NULL,
        content  TEXT    NOT NULL,
        importance REAL  NOT NULL DEFAULT 0,
        created_at TEXT  NOT NULL,
        accessed_at TEXT NOT NULL,
        tags     TEXT    NOT NULL DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_memory_id ON memory_entries(id);

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_entries_fts USING fts5(
        content,
        tags,
        content='memory_entries',
        content_rowid='rowid'
      );
    `);
  }

  /**
   * Ensure the memory_vec virtual table has the right dimension.
   * Called lazily on first vector operation when we know the actual dimension.
   */
  private ensureVecTable(dim: number): void {
    const row = this.db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_vec'`)
      .get() as { sql: string } | undefined;

    if (!row) {
      this.db.exec(`CREATE VIRTUAL TABLE memory_vec USING vec0(embedding float[${dim}])`);
      return;
    }

    const actualDim = this.getVecTableDimension(row.sql);
    if (actualDim !== dim) {
      throw new Error(
        `memory_vec embedding dimension mismatch: table uses ${actualDim}, requested ${dim}. ` +
          "Refusing to recreate the vector table implicitly because that would delete existing embeddings."
      );
    }
  }

  private getVecTableDimension(sql: string): number {
    const match = sql.match(/embedding\s+float\[(\d+)\]/i);
    if (!match) {
      throw new Error("Unable to determine memory_vec embedding dimension from sqlite schema");
    }
    return Number(match[1]);
  }

  private hasVecTable(): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_vec'`)
      .get();
    return Boolean(row);
  }

  async store(entry: Omit<MemoryEntry, "id">): Promise<MemoryEntry> {
    const id = crypto.randomUUID();

    const insert = this.db.prepare(`
      INSERT INTO memory_entries(id, content, importance, created_at, accessed_at, tags)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING rowid
    `);

    const row = insert.get(
      id,
      entry.content,
      entry.importance,
      entry.createdAt.toISOString(),
      entry.accessedAt.toISOString(),
      JSON.stringify(entry.tags ?? [])
    ) as { rowid: number };

    // Update FTS index
    this.db
      .prepare(`INSERT INTO memory_entries_fts(rowid, content, tags) VALUES (?, ?, ?)`)
      .run(row.rowid, entry.content, JSON.stringify(entry.tags ?? []));

    // Store embedding if provided
    if (entry.embedding && entry.embedding.length > 0) {
      this.ensureVecTable(entry.embedding.length);
      this.db
        .prepare(`INSERT INTO memory_vec(rowid, embedding) VALUES (?, ?)`)
        .run(BigInt(row.rowid), serializeEmbedding(entry.embedding));
    }

    return { id, ...entry };
  }

  async findById(id: string): Promise<MemoryEntry | null> {
    const row = this.db.prepare(`SELECT * FROM memory_entries WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;
    return this.rowToEntry(row);
  }

  async list(limit: number = 100): Promise<MemoryEntry[]> {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM memory_entries
        ORDER BY created_at DESC
        LIMIT ?
      `
      )
      .all(limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToEntry(r));
  }

  async search(query: string, limit: number = 10): Promise<MemoryEntry[]> {
    if (query.trim().length === 0) return [];

    const rows = this.db
      .prepare(
        `
        SELECT me.* FROM memory_entries me
        JOIN memory_entries_fts fts ON me.rowid = fts.rowid
        WHERE memory_entries_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `
      )
      .all(query, limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToEntry(r));
  }

  async searchByEmbedding(embedding: number[], limit: number = 10): Promise<MemoryEntry[]> {
    if (embedding.length === 0) return [];

    this.ensureVecTable(embedding.length);

    const rows = this.db
      .prepare(
        `
        SELECT me.*, v.distance
        FROM memory_vec v
        JOIN memory_entries me ON me.rowid = v.rowid
        WHERE v.embedding MATCH ? AND v.k = ?
        ORDER BY v.distance
      `
      )
      .all(serializeEmbedding(embedding), limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToEntry(r, { includeVectorScore: true }));
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<MemoryEntry> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Memory entry '${id}' not found`);

    const merged = { ...existing, ...updates, id };

    const row = this.db.prepare(`SELECT rowid FROM memory_entries WHERE id = ?`).get(id) as
      | { rowid: number }
      | undefined;
    if (!row) throw new Error(`Memory entry '${id}' not found`);

    this.db
      .prepare(
        `
        UPDATE memory_entries
        SET content = ?, importance = ?, accessed_at = ?, tags = ?
        WHERE id = ?
      `
      )
      .run(
        merged.content,
        merged.importance,
        merged.accessedAt.toISOString(),
        JSON.stringify(merged.tags ?? []),
        id
      );

    // Rebuild FTS row
    this.db.prepare(`DELETE FROM memory_entries_fts WHERE rowid = ?`).run(row.rowid);
    this.db
      .prepare(`INSERT INTO memory_entries_fts(rowid, content, tags) VALUES (?, ?, ?)`)
      .run(row.rowid, merged.content, JSON.stringify(merged.tags ?? []));

    // Update embedding if provided
    if (updates.embedding && updates.embedding.length > 0) {
      this.ensureVecTable(updates.embedding.length);
      this.db.prepare(`DELETE FROM memory_vec WHERE rowid = ?`).run(BigInt(row.rowid));
      this.db
        .prepare(`INSERT INTO memory_vec(rowid, embedding) VALUES (?, ?)`)
        .run(BigInt(row.rowid), serializeEmbedding(updates.embedding));
    }

    return merged;
  }

  async delete(id: string): Promise<void> {
    const row = this.db.prepare(`SELECT rowid FROM memory_entries WHERE id = ?`).get(id) as
      | { rowid: number }
      | undefined;
    if (!row) return;

    this.db.prepare(`DELETE FROM memory_entries_fts WHERE rowid = ?`).run(row.rowid);
    if (this.hasVecTable()) {
      this.db.prepare(`DELETE FROM memory_vec WHERE rowid = ?`).run(BigInt(row.rowid));
    }
    this.db.prepare(`DELETE FROM memory_entries WHERE id = ?`).run(id);
  }

  async compact(maxAge: Date): Promise<number> {
    const rows = this.db
      .prepare(`SELECT id, rowid FROM memory_entries WHERE accessed_at < ?`)
      .all(maxAge.toISOString()) as { id: string; rowid: number }[];

    for (const row of rows) {
      this.db.prepare(`DELETE FROM memory_entries_fts WHERE rowid = ?`).run(row.rowid);
      if (this.hasVecTable()) {
        this.db.prepare(`DELETE FROM memory_vec WHERE rowid = ?`).run(BigInt(row.rowid));
      }
    }
    const result = this.db
      .prepare(`DELETE FROM memory_entries WHERE accessed_at < ?`)
      .run(maxAge.toISOString());

    return result.changes;
  }

  private rowToEntry(
    row: Record<string, unknown>,
    options: { includeVectorScore?: boolean } = {}
  ): MemoryEntry {
    const distance = typeof row.distance === "number" ? row.distance : undefined;
    const vectorScore =
      options.includeVectorScore && distance !== undefined ? 1 - distance : undefined;

    return {
      id: row.id as string,
      content: row.content as string,
      importance: row.importance as number,
      createdAt: new Date(row.created_at as string),
      accessedAt: new Date(row.accessed_at as string),
      tags: JSON.parse((row.tags as string) || "[]") as string[],
      ...(vectorScore !== undefined ? { score: vectorScore, vectorScore } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// SQLiteTaskRepository
// ---------------------------------------------------------------------------

/**
 * SQLite-backed task repository with task results stored as JSON blobs.
 */
export class SQLiteTaskRepository extends SQLiteBase implements TaskRepository {
  constructor(connection: SQLiteConnection | string) {
    super(connection);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        payload      TEXT NOT NULL DEFAULT '{}',
        priority     TEXT NOT NULL DEFAULT '{"level":"normal","weight":1}',
        created_at   TEXT NOT NULL,
        deadline     TEXT,
        assigned_agent TEXT,
        status       TEXT NOT NULL DEFAULT 'pending'
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);

      CREATE TABLE IF NOT EXISTS task_results (
        task_id        TEXT PRIMARY KEY,
        success        INTEGER NOT NULL,
        output         TEXT,
        error          TEXT,
        execution_time REAL NOT NULL DEFAULT 0,
        agent_id       TEXT NOT NULL
      );
    `);
  }

  async create(task: Omit<Task, "id" | "createdAt" | "status">): Promise<Task> {
    const id = crypto.randomUUID();
    const now = new Date();

    this.db
      .prepare(
        `
        INSERT INTO tasks(id, name, payload, priority, created_at, deadline, assigned_agent, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      `
      )
      .run(
        id,
        task.name,
        JSON.stringify(task.payload ?? {}),
        JSON.stringify(task.priority),
        now.toISOString(),
        task.deadline ? task.deadline.toISOString() : null,
        task.assignedAgent ?? null
      );

    return {
      id,
      ...task,
      createdAt: now,
      status: "pending",
    };
  }

  async findById(id: string): Promise<Task | null> {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;
    return this.rowToTask(row);
  }

  async findByStatus(status: Task["status"]): Promise<Task[]> {
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC`)
      .all(status) as Record<string, unknown>[];

    return rows.map((r) => this.rowToTask(r));
  }

  async findPending(limit: number = 10): Promise<Task[]> {
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToTask(r));
  }

  async update(id: string, updates: Partial<Task>): Promise<Task> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Task '${id}' not found`);

    const merged = { ...existing, ...updates, id };

    this.db
      .prepare(
        `
        UPDATE tasks
        SET name = ?, payload = ?, priority = ?, deadline = ?,
            assigned_agent = ?, status = ?
        WHERE id = ?
      `
      )
      .run(
        merged.name,
        JSON.stringify(merged.payload),
        JSON.stringify(merged.priority),
        merged.deadline ? merged.deadline.toISOString() : null,
        merged.assignedAgent ?? null,
        merged.status,
        id
      );

    return merged;
  }

  async storeResult(result: TaskResult): Promise<void> {
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO task_results(task_id, success, output, error, execution_time, agent_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        result.taskId,
        result.success ? 1 : 0,
        JSON.stringify(result.output ?? null),
        result.error ?? null,
        result.executionTime,
        result.agentId
      );
  }

  async getResult(taskId: string): Promise<TaskResult | null> {
    const row = this.db.prepare(`SELECT * FROM task_results WHERE task_id = ?`).get(taskId) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;

    return {
      taskId: row.task_id as string,
      success: Boolean(row.success),
      output: JSON.parse((row.output as string) || "null") as unknown,
      error: (row.error as string | null) ?? undefined,
      executionTime: row.execution_time as number,
      agentId: row.agent_id as string,
    };
  }

  private rowToTask(row: Record<string, unknown>): Task {
    return {
      id: row.id as string,
      name: row.name as string,
      payload: JSON.parse((row.payload as string) || "{}") as Record<string, unknown>,
      priority: JSON.parse(row.priority as string) as Task["priority"],
      createdAt: new Date(row.created_at as string),
      deadline: row.deadline ? new Date(row.deadline as string) : undefined,
      assignedAgent: (row.assigned_agent as string | null) ?? undefined,
      status: row.status as Task["status"],
    };
  }
}

// ---------------------------------------------------------------------------
// SQLiteSessionRepository
// ---------------------------------------------------------------------------

/**
 * SQLite-backed session repository.
 */
export class SQLiteSessionRepository extends SQLiteBase implements SessionRepository {
  constructor(connection: SQLiteConnection | string) {
    super(connection);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ended_at   TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    `);
  }

  async create(userId: string): Promise<{ id: string; userId: string; createdAt: Date }> {
    const id = crypto.randomUUID();
    const now = new Date();

    this.db
      .prepare(`INSERT INTO sessions(id, user_id, created_at) VALUES (?, ?, ?)`)
      .run(id, userId, now.toISOString());

    return { id, userId, createdAt: now };
  }

  async findById(id: string): Promise<{ id: string; userId: string; createdAt: Date } | null> {
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE id = ? AND ended_at IS NULL`)
      .get(id) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.rowToSession(row);
  }

  async findByUser(userId: string): Promise<{ id: string; userId: string; createdAt: Date }[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM sessions WHERE user_id = ? AND ended_at IS NULL ORDER BY created_at DESC`
      )
      .all(userId) as Record<string, unknown>[];

    return rows.map((r) => this.rowToSession(r));
  }

  async end(id: string): Promise<void> {
    this.db
      .prepare(`UPDATE sessions SET ended_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
  }

  private rowToSession(row: Record<string, unknown>): {
    id: string;
    userId: string;
    createdAt: Date;
  } {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      createdAt: new Date(row.created_at as string),
    };
  }
}

// ---------------------------------------------------------------------------
// SQLiteEventRepository
// ---------------------------------------------------------------------------

/**
 * SQLite-backed event repository for audit logging and event sourcing.
 */
export class SQLiteEventRepository extends SQLiteBase implements EventRepository {
  constructor(connection: SQLiteConnection | string) {
    super(connection);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS domain_events (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL,
        timestamp  TEXT NOT NULL,
        payload    TEXT NOT NULL DEFAULT '{}',
        source     TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_type      ON domain_events(type);
      CREATE INDEX IF NOT EXISTS idx_events_source    ON domain_events(source);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON domain_events(timestamp);
    `);
  }

  async store(event: DomainEvent): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO domain_events(id, type, timestamp, payload, source)
        VALUES (?, ?, ?, ?, ?)
      `
      )
      .run(
        event.id,
        event.type,
        event.timestamp.toISOString(),
        JSON.stringify(event.payload ?? {}),
        event.source
      );
  }

  async findByType(type: string, limit: number = 100): Promise<DomainEvent[]> {
    const rows = this.db
      .prepare(`SELECT * FROM domain_events WHERE type = ? ORDER BY timestamp DESC LIMIT ?`)
      .all(type, limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToEvent(r));
  }

  async findBySource(source: string, limit: number = 100): Promise<DomainEvent[]> {
    const rows = this.db
      .prepare(`SELECT * FROM domain_events WHERE source = ? ORDER BY timestamp DESC LIMIT ?`)
      .all(source, limit) as Record<string, unknown>[];

    return rows.map((r) => this.rowToEvent(r));
  }

  async findInRange(from: Date, to: Date): Promise<DomainEvent[]> {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM domain_events
        WHERE timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC
      `
      )
      .all(from.toISOString(), to.toISOString()) as Record<string, unknown>[];

    return rows.map((r) => this.rowToEvent(r));
  }

  private rowToEvent(row: Record<string, unknown>): DomainEvent {
    return {
      id: row.id as string,
      type: row.type as string,
      timestamp: new Date(row.timestamp as string),
      payload: JSON.parse((row.payload as string) || "{}") as Record<string, unknown>,
      source: row.source as string,
    };
  }
}
