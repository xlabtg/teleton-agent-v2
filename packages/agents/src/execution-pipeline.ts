/**
 * Execution Pipeline — V2-09.
 * Orchestrates multi-step workflows with:
 *  - Dependency-aware step ordering (topological sort)
 *  - Per-step retry with exponential backoff
 *  - Automatic checkpointing after each successful step
 *  - Rollback on failure (if compensators are registered)
 *  - Progress streaming via callbacks
 */

import type { CheckpointEntry, CheckpointStore } from "./checkpoint-store.js";
import type { RollbackHandler } from "./rollback-handler.js";
import {
  validatePipelineTransition,
  type PipelineState,
  type PipelineStatus,
  type StepDefinition,
  type StepState,
  type StepStatus,
} from "./pipeline-state.js";
import { ValidationError } from "../../core/src/errors/domain-errors.js";

export type StepExecutor = (stepName: string, context: Record<string, unknown>) => Promise<unknown>;

export type ProgressStatus = StepStatus | "checkpoint_failed";

export type ProgressCallback = (
  pipelineId: string,
  stepName: string,
  status: ProgressStatus,
  output?: unknown
) => void;

export interface PipelineDefinition {
  name: string;
  steps: StepDefinition[];
  context?: Record<string, unknown>;
}

export interface ExecutionPipelineConfig {
  checkpointStore?: CheckpointStore;
  rollbackHandler?: RollbackHandler;
  onProgress?: ProgressCallback;
  /**
   * Default retry policy applied when a step has none of its own.
   * Default: { maxAttempts: 1, backoffMs: 0 } (no retry).
   */
  defaultRetry?: { maxAttempts: number; backoffMs: number };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildExecutionOrder(steps: StepDefinition[]): StepDefinition[][] {
  // Topological sort into waves of parallelisable steps.
  const nameSet = new Set(steps.map((s) => s.name));
  const remaining = new Set(steps.map((s) => s.name));
  const resolved = new Set<string>();
  const waves: StepDefinition[][] = [];

  while (remaining.size > 0) {
    const wave = steps.filter((s) => {
      if (!remaining.has(s.name)) return false;
      const deps = s.dependsOn ?? [];
      return deps.every((d) => {
        if (!nameSet.has(d)) return true; // external dep — assume resolved
        return resolved.has(d);
      });
    });

    if (wave.length === 0) {
      throw new ValidationError(
        `Circular dependency detected in pipeline. Unresolved steps: ${Array.from(remaining).join(", ")}`
      );
    }

    waves.push(wave);
    for (const s of wave) {
      remaining.delete(s.name);
      resolved.add(s.name);
    }
  }

  return waves;
}

export class ExecutionPipeline {
  private readonly checkpointStore?: CheckpointStore;
  private readonly rollbackHandler?: RollbackHandler;
  private readonly onProgress?: ProgressCallback;
  private readonly defaultRetry: { maxAttempts: number; backoffMs: number };

  constructor(config: ExecutionPipelineConfig = {}) {
    this.checkpointStore = config.checkpointStore;
    this.rollbackHandler = config.rollbackHandler;
    this.onProgress = config.onProgress;
    this.defaultRetry = config.defaultRetry ?? { maxAttempts: 1, backoffMs: 0 };
  }

  /** Create a new pipeline state from a definition. */
  create(definition: PipelineDefinition): PipelineState {
    const steps = new Map<string, StepState>();
    for (const stepDef of definition.steps) {
      steps.set(stepDef.name, {
        definition: stepDef,
        status: "pending",
        attempt: 0,
      });
    }

    return {
      id: crypto.randomUUID(),
      name: definition.name,
      status: "pending",
      steps,
      createdAt: new Date(),
      updatedAt: new Date(),
      context: definition.context ?? {},
    };
  }

  /**
   * Execute a pipeline end-to-end.
   * Throws if the pipeline definition contains a circular dependency.
   */
  async run(state: PipelineState, executor: StepExecutor): Promise<PipelineState> {
    this.transition(state, "running");

    try {
      const waves = buildExecutionOrder(Array.from(state.steps.values()).map((s) => s.definition));

      for (const wave of waves) {
        const pendingWave = wave.filter(
          (stepDef) => state.steps.get(stepDef.name)?.status !== "completed"
        );
        if (pendingWave.length === 0) continue;

        // All steps in a wave run concurrently.
        await Promise.all(
          pendingWave.map((stepDef) => this.executeStep(state, stepDef.name, executor))
        );

        // Check if any step in this wave failed (failFast mode).
        const anyFailed = wave.some((s) => state.steps.get(s.name)?.status === "failed");
        if (anyFailed) {
          throw new Error("Step failed; aborting pipeline");
        }
      }

      this.transition(state, "completed");
    } catch (err) {
      this.setStatus(state, "failed");
      state.updatedAt = new Date();

      if (this.rollbackHandler) {
        await this.rollbackHandler.rollback(state);
        this.setStatus(state, "rolled_back");
      }
    }

    return state;
  }

  /**
   * Resume a pipeline from its latest checkpoint.
   * Completed steps from the checkpoint are not re-executed.
   */
  async resume(pipelineId: string, executor: StepExecutor): Promise<PipelineState> {
    if (!this.checkpointStore) {
      throw new Error("Cannot resume pipeline without a checkpoint store");
    }

    const checkpoint = this.checkpointStore.load(pipelineId);
    if (!checkpoint) {
      throw new Error(`No checkpoint found for pipeline "${pipelineId}"`);
    }

    return this.run(this.hydrateCheckpoint(checkpoint), executor);
  }

  private hydrateCheckpoint(checkpoint: CheckpointEntry): PipelineState {
    const snapshot = checkpoint.snapshot;
    const steps = new Map<string, StepState>();

    for (const [name, value] of Object.entries(snapshot.steps)) {
      const step = value as StepState;
      steps.set(name, {
        ...step,
        definition: { ...step.definition },
        status: step.status === "running" ? "pending" : step.status,
        startedAt: step.startedAt ? new Date(step.startedAt) : undefined,
        completedAt: step.completedAt ? new Date(step.completedAt) : undefined,
      });
    }

    return {
      id: snapshot.id,
      name: snapshot.name,
      status: "pending",
      steps,
      createdAt: new Date(snapshot.createdAt),
      updatedAt: new Date(snapshot.updatedAt),
      context: structuredClone(snapshot.context),
    };
  }

  private async executeStep(
    state: PipelineState,
    stepName: string,
    executor: StepExecutor
  ): Promise<void> {
    const stepState = state.steps.get(stepName)!;
    const retry = stepState.definition.retry ?? this.defaultRetry;

    this.setStepStatus(state, stepName, "running");
    this.onProgress?.(state.id, stepName, "running");

    let lastError: unknown;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      stepState.attempt = attempt;
      stepState.startedAt = new Date();

      let output: unknown;

      try {
        if (stepState.definition.timeoutMs) {
          output = await withTimeout(
            executor(stepName, state.context),
            stepState.definition.timeoutMs,
            `Step "${stepName}" timed out after ${stepState.definition.timeoutMs}ms`
          );
        } else {
          output = await executor(stepName, state.context);
        }
      } catch (err) {
        lastError = err;

        if (attempt < retry.maxAttempts) {
          const delay = retry.backoffMs * Math.pow(2, attempt - 1);
          if (delay > 0) await sleep(delay);
        }
        continue;
      }

      stepState.output = output;
      stepState.completedAt = new Date();
      this.setStepStatus(state, stepName, "completed");
      this.onProgress?.(state.id, stepName, "completed", output);

      // Expose step output in the shared context for downstream steps.
      state.context[`step.${stepName}.output`] = output;

      this.saveCheckpoint(state, stepName);
      return;
    }

    stepState.error = String(lastError);
    stepState.completedAt = new Date();
    this.setStepStatus(state, stepName, "failed");
    this.onProgress?.(state.id, stepName, "failed");
  }

  private saveCheckpoint(state: PipelineState, stepName: string): void {
    if (!this.checkpointStore) return;

    try {
      this.checkpointStore.save(state);
    } catch (err) {
      this.onProgress?.(state.id, stepName, "checkpoint_failed", err);
    }
  }

  private transition(state: PipelineState, to: PipelineStatus): void {
    validatePipelineTransition(state.status, to);
    this.setStatus(state, to);
  }

  private setStatus(state: PipelineState, status: PipelineStatus): void {
    state.status = status;
    state.updatedAt = new Date();
  }

  private setStepStatus(state: PipelineState, stepName: string, status: StepStatus): void {
    const stepState = state.steps.get(stepName);
    if (stepState) {
      stepState.status = status;
      state.updatedAt = new Date();
    }
  }
}
