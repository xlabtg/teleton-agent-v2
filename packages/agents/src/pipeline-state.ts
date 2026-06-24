/**
 * Pipeline State — V2-09.
 * Defines the state machine types for a multi-step execution pipeline.
 * Each pipeline moves through well-defined states; transitions are validated
 * to prevent illegal jumps (e.g. "completed" → "running").
 */

export type PipelineStatus = "pending" | "running" | "completed" | "failed" | "rolled_back";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "rolled_back";

export interface StepDefinition {
  /** Unique step name within the pipeline. */
  name: string;
  /** Human-readable description. */
  description?: string;
  /**
   * Names of steps that must complete before this one starts.
   * Empty array means the step can run immediately (or in parallel with peers).
   */
  dependsOn?: string[];
  /**
   * Optional maximum execution time for this step in milliseconds.
   * Default: no limit.
   */
  timeoutMs?: number;
  /**
   * Retry policy for this specific step.
   */
  retry?: RetryPolicy;
}

export interface RetryPolicy {
  maxAttempts: number;
  /** Base backoff in milliseconds. Actual delay = backoffMs * 2^(attempt-1). */
  backoffMs: number;
}

export interface StepState {
  definition: StepDefinition;
  status: StepStatus;
  attempt: number;
  startedAt?: Date;
  completedAt?: Date;
  output?: unknown;
  error?: string;
}

export interface PipelineState {
  id: string;
  name: string;
  status: PipelineStatus;
  steps: Map<string, StepState>;
  createdAt: Date;
  updatedAt: Date;
  /** Context data available to all steps. */
  context: Record<string, unknown>;
}

/** Allowed status transitions for a pipeline. */
const PIPELINE_TRANSITIONS: Record<PipelineStatus, PipelineStatus[]> = {
  pending: ["running", "failed"],
  running: ["completed", "failed"],
  completed: [],
  failed: ["rolled_back"],
  rolled_back: [],
};

export function validatePipelineTransition(from: PipelineStatus, to: PipelineStatus): void {
  const allowed = PIPELINE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid pipeline status transition: "${from}" → "${to}". Allowed: ${allowed.join(", ") || "none"}`
    );
  }
}
