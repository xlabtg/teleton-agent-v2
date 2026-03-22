/**
 * Rollback Handler — V2-09.
 * Manages compensating actions for steps that need to be undone when a
 * pipeline fails. Handlers are registered per step name and are invoked
 * in reverse completion order (LIFO) during rollback.
 */

import type { PipelineState, StepState } from "./pipeline-state.js";

/**
 * A compensating action for a single pipeline step.
 * Receives the step's recorded output and context so it can undo side-effects.
 */
export type CompensatingAction = (
  stepOutput: unknown,
  context: Record<string, unknown>
) => Promise<void> | void;

export interface RollbackResult {
  pipelineId: string;
  rolledBackSteps: string[];
  skippedSteps: string[];
  errors: Array<{ stepName: string; error: string }>;
}

export class RollbackHandler {
  /** Map: step name → compensating action. */
  private readonly compensators = new Map<string, CompensatingAction>();

  /** Register a compensating action for a named step. */
  register(stepName: string, action: CompensatingAction): void {
    this.compensators.set(stepName, action);
  }

  /** Remove a registered compensating action. */
  unregister(stepName: string): void {
    this.compensators.delete(stepName);
  }

  /** True if a compensating action is registered for the given step. */
  has(stepName: string): boolean {
    return this.compensators.has(stepName);
  }

  /**
   * Execute rollback for all completed steps in the pipeline.
   * Steps are rolled back in LIFO order (most recently completed first).
   * Steps without a registered compensator are skipped (not treated as errors).
   */
  async rollback(state: PipelineState): Promise<RollbackResult> {
    // Collect completed steps in order of completion time.
    const completed: Array<[string, StepState]> = [];
    for (const [name, stepState] of state.steps) {
      if (stepState.status === "completed" && stepState.completedAt) {
        completed.push([name, stepState]);
      }
    }

    // Sort descending by completedAt so we roll back LIFO.
    completed.sort(
      ([, a], [, b]) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)
    );

    const rolledBackSteps: string[] = [];
    const skippedSteps: string[] = [];
    const errors: Array<{ stepName: string; error: string }> = [];

    for (const [name, stepState] of completed) {
      const compensator = this.compensators.get(name);
      if (!compensator) {
        skippedSteps.push(name);
        continue;
      }

      try {
        await compensator(stepState.output, state.context);
        rolledBackSteps.push(name);
        // Mark step as rolled back in the live state.
        stepState.status = "rolled_back";
      } catch (err) {
        errors.push({ stepName: name, error: String(err) });
      }
    }

    return {
      pipelineId: state.id,
      rolledBackSteps,
      skippedSteps,
      errors,
    };
  }
}
