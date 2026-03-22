/**
 * Result Aggregator — V2-08.
 * Collects the outputs of parallel / sequential subtask executions and merges
 * them into a single coherent result. Handles partial failures gracefully and
 * provides an audit trail of every subtask outcome.
 */

export type SubTaskStatus = "pending" | "success" | "failed" | "skipped";

export interface SubTaskResult {
  subtaskId: string;
  agentId: string | null;
  status: SubTaskStatus;
  output: unknown;
  error?: string;
  /** Wall-clock execution time in milliseconds. */
  durationMs: number;
  completedAt: Date;
}

export interface AggregatedResult {
  taskId: string;
  /** True only when every subtask succeeded. */
  success: boolean;
  /** Merged output map: subtaskId → output. */
  outputs: Record<string, unknown>;
  /** List of subtask ids that failed. */
  failures: string[];
  subtaskResults: SubTaskResult[];
  totalDurationMs: number;
}

export interface ResultAggregatorConfig {
  /**
   * If true, the aggregated result is a failure as soon as any subtask fails.
   * If false, partial failures are tolerated and `success` reflects the majority.
   * Default: true.
   */
  failFast?: boolean;
}

export class ResultAggregator {
  private readonly failFast: boolean;
  private readonly results = new Map<string, SubTaskResult>();

  constructor(config: ResultAggregatorConfig = {}) {
    this.failFast = config.failFast ?? true;
  }

  /** Record the outcome of a single subtask. */
  record(result: SubTaskResult): void {
    this.results.set(result.subtaskId, result);
  }

  /**
   * Build the final aggregated result for a task.
   * Call this after all subtasks have been recorded (or after a failFast trigger).
   */
  aggregate(taskId: string): AggregatedResult {
    const subtaskResults = Array.from(this.results.values());
    const failures = subtaskResults.filter((r) => r.status === "failed").map((r) => r.subtaskId);

    const success = this.failFast ? failures.length === 0 : failures.length < subtaskResults.length;

    const outputs: Record<string, unknown> = {};
    for (const r of subtaskResults) {
      if (r.status === "success") {
        outputs[r.subtaskId] = r.output;
      }
    }

    const totalDurationMs = subtaskResults.reduce((sum, r) => sum + r.durationMs, 0);

    return {
      taskId,
      success,
      outputs,
      failures,
      subtaskResults,
      totalDurationMs,
    };
  }

  /** True if at least one recorded subtask has failed (used for failFast logic). */
  get hasFailed(): boolean {
    return Array.from(this.results.values()).some((r) => r.status === "failed");
  }

  /** Number of recorded subtask results. */
  get count(): number {
    return this.results.size;
  }

  /** Reset all recorded results (for reuse across tasks). */
  reset(): void {
    this.results.clear();
  }
}
