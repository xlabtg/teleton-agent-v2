/**
 * Checkpoint Store — V2-09.
 * Persists pipeline state snapshots so that a failed or interrupted pipeline
 * can be resumed from the last successful checkpoint rather than restarting
 * from scratch.
 *
 * This in-memory implementation is suitable for single-process deployments and
 * testing. For durable, multi-process deployments swap in a persistence-backed
 * adapter by implementing the CheckpointStore interface.
 */

import type { PipelineState } from "./pipeline-state.js";

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends Date
    ? T
    : T extends readonly (infer U)[]
      ? readonly DeepReadonly<U>[]
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

export interface CheckpointEntry {
  pipelineId: string;
  checkpointAt: Date;
  /** Deep-cloned snapshot of the pipeline state at checkpoint time. Dates remain Date instances. */
  snapshot: DeepReadonly<Omit<PipelineState, "steps"> & { steps: Record<string, unknown> }>;
}

export interface CheckpointStore {
  save(state: PipelineState): void;
  load(pipelineId: string): CheckpointEntry | undefined;
  listCheckpoints(pipelineId: string): CheckpointEntry[];
  remove(pipelineId: string): void;
}

/** Serialise a PipelineState Map<> to a plain object for snapshotting. */
function serialise(state: PipelineState): CheckpointEntry["snapshot"] {
  const steps: Record<string, unknown> = {};
  for (const [name, stepState] of state.steps) {
    steps[name] = {
      ...stepState,
      definition: { ...stepState.definition },
      output: structuredClone(stepState.output),
    };
  }
  return {
    ...state,
    context: structuredClone(state.context),
    steps,
  } as CheckpointEntry["snapshot"];
}

export class InMemoryCheckpointStore implements CheckpointStore {
  /** Map: pipelineId → ordered list of checkpoints (oldest first). */
  private readonly store = new Map<string, CheckpointEntry[]>();
  /**
   * Maximum checkpoints to keep per pipeline.
   * Oldest entries are evicted once the limit is reached. Default: 20.
   */
  private readonly maxPerPipeline: number;

  constructor(maxPerPipeline = 20) {
    this.maxPerPipeline = maxPerPipeline;
  }

  save(state: PipelineState): void {
    const entry: CheckpointEntry = {
      pipelineId: state.id,
      checkpointAt: new Date(),
      snapshot: serialise(state),
    };

    const existing = this.store.get(state.id) ?? [];
    existing.push(entry);

    if (existing.length > this.maxPerPipeline) {
      existing.splice(0, existing.length - this.maxPerPipeline);
    }

    this.store.set(state.id, existing);
  }

  /** Return the latest checkpoint for a pipeline, or undefined. */
  load(pipelineId: string): CheckpointEntry | undefined {
    const entries = this.store.get(pipelineId);
    return entries?.[entries.length - 1];
  }

  listCheckpoints(pipelineId: string): CheckpointEntry[] {
    return this.store.get(pipelineId) ?? [];
  }

  remove(pipelineId: string): void {
    this.store.delete(pipelineId);
  }

  /** Total number of checkpoint entries across all pipelines. */
  get totalEntries(): number {
    return Array.from(this.store.values()).reduce((sum, arr) => sum + arr.length, 0);
  }
}
