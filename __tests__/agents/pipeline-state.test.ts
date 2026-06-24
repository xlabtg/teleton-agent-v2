import { describe, expect, it } from "vitest";
import {
  validatePipelineTransition,
  type PipelineStatus,
  type StepStatus,
} from "../../packages/agents/src/pipeline-state.js";

type AssertNever<T extends never> = T;
export type StepStatusDoesNotContainSkipped = AssertNever<Extract<StepStatus, "skipped">>;

const pipelineStatuses = [
  "pending",
  "running",
  "completed",
  "failed",
  "rolled_back",
] as const satisfies readonly PipelineStatus[];

const allowedTransitions = new Set<string>([
  "pending->running",
  "pending->failed",
  "running->completed",
  "running->failed",
  "failed->rolled_back",
]);

function transitionKey(from: PipelineStatus, to: PipelineStatus): string {
  return `${from}->${to}`;
}

describe("pipeline state machine", () => {
  it("allows every reachable pipeline transition", () => {
    for (const transition of allowedTransitions) {
      const [from, to] = transition.split("->") as [PipelineStatus, PipelineStatus];

      expect(() => validatePipelineTransition(from, to)).not.toThrow();
    }
  });

  it("rejects every unreachable transition in the active pipeline lifecycle", () => {
    for (const from of pipelineStatuses) {
      for (const to of pipelineStatuses) {
        const key = transitionKey(from, to);
        if (allowedTransitions.has(key)) continue;

        expect(() => validatePipelineTransition(from, to)).toThrow(
          /Invalid pipeline status transition/
        );
      }
    }
  });

  it("rejects the historical paused transition until pause/resume is implemented", () => {
    expect(() => validatePipelineTransition("running", "paused" as PipelineStatus)).toThrow(
      /Invalid pipeline status transition/
    );
    expect(() => validatePipelineTransition("paused" as PipelineStatus, "running")).toThrow(
      /Invalid pipeline status transition/
    );
  });
});
