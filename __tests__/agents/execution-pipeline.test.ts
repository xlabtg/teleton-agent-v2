import { describe, it, expect, vi } from "vitest";
import { ExecutionPipeline } from "../../packages/agents/src/execution-pipeline.js";
import { InMemoryCheckpointStore } from "../../packages/agents/src/checkpoint-store.js";
import { RollbackHandler } from "../../packages/agents/src/rollback-handler.js";

// ── ExecutionPipeline ────────────────────────────────────────────────────────

describe("ExecutionPipeline", () => {
  it("should run a simple linear pipeline and complete", async () => {
    const pipeline = new ExecutionPipeline();
    const state = pipeline.create({
      name: "test-pipeline",
      steps: [{ name: "step-a" }, { name: "step-b", dependsOn: ["step-a"] }],
    });

    const executor = vi.fn().mockResolvedValue("ok");
    await pipeline.run(state, executor);

    expect(state.status).toBe("completed");
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("should mark pipeline failed when a step fails", async () => {
    const pipeline = new ExecutionPipeline();
    const state = pipeline.create({ name: "fail-pipe", steps: [{ name: "bad-step" }] });

    await pipeline.run(state, async () => {
      throw new Error("step error");
    });

    expect(state.status).toBe("failed");
    expect(state.steps.get("bad-step")?.status).toBe("failed");
    expect(state.steps.get("bad-step")?.error).toContain("step error");
  });

  it("should retry a failing step according to retry policy", async () => {
    const pipeline = new ExecutionPipeline();
    const state = pipeline.create({
      name: "retry-pipe",
      steps: [{ name: "flaky", retry: { maxAttempts: 3, backoffMs: 0 } }],
    });

    let attempts = 0;
    await pipeline.run(state, async () => {
      attempts++;
      if (attempts < 3) throw new Error("transient");
      return "success";
    });

    expect(state.status).toBe("completed");
    expect(attempts).toBe(3);
  });

  it("should checkpoint after each successful step", async () => {
    const store = new InMemoryCheckpointStore();
    const pipeline = new ExecutionPipeline({ checkpointStore: store });
    const state = pipeline.create({
      name: "cp-pipe",
      steps: [{ name: "a" }, { name: "b", dependsOn: ["a"] }],
    });

    await pipeline.run(state, async () => "ok");

    // Two steps = two checkpoints
    expect(store.listCheckpoints(state.id).length).toBe(2);
  });

  it("should invoke rollback handler on failure", async () => {
    const rollback = new RollbackHandler();
    const compensator = vi.fn();
    rollback.register("good-step", compensator);

    const pipeline = new ExecutionPipeline({ rollbackHandler: rollback });
    const state = pipeline.create({
      name: "rb-pipe",
      steps: [{ name: "good-step" }, { name: "bad-step", dependsOn: ["good-step"] }],
    });

    await pipeline.run(state, async (name) => {
      if (name === "bad-step") throw new Error("boom");
      return "done";
    });

    expect(state.status).toBe("rolled_back");
    expect(compensator).toHaveBeenCalledTimes(1);
  });

  it("should call progress callback for each step transition", async () => {
    const events: string[] = [];
    const pipeline = new ExecutionPipeline({
      onProgress: (_id, name, status) => events.push(`${name}:${status}`),
    });
    const state = pipeline.create({ name: "progress-pipe", steps: [{ name: "x" }] });
    await pipeline.run(state, async () => "result");

    expect(events).toContain("x:running");
    expect(events).toContain("x:completed");
  });

  it("should detect circular dependency and throw", async () => {
    const pipeline = new ExecutionPipeline();
    const state = pipeline.create({
      name: "circular",
      steps: [
        { name: "a", dependsOn: ["b"] },
        { name: "b", dependsOn: ["a"] },
      ],
    });

    await pipeline.run(state, async () => "ok");
    expect(state.status).toBe("failed");
  });

  it("should pass step output to subsequent steps via context", async () => {
    const pipeline = new ExecutionPipeline();
    const state = pipeline.create({
      name: "ctx-pipe",
      steps: [{ name: "producer" }, { name: "consumer", dependsOn: ["producer"] }],
    });

    const contextCaptures: Record<string, unknown>[] = [];
    await pipeline.run(state, async (name, ctx) => {
      contextCaptures.push({ ...ctx });
      return name === "producer" ? 42 : "consumed";
    });

    // Consumer's context should contain producer's output.
    const consumerCtx = contextCaptures[1];
    expect(consumerCtx["step.producer.output"]).toBe(42);
  });
});

// ── CheckpointStore ──────────────────────────────────────────────────────────

describe("InMemoryCheckpointStore", () => {
  it("should save and load a checkpoint", () => {
    const store = new InMemoryCheckpointStore();
    const state = {
      id: "p1",
      name: "test",
      status: "running" as const,
      steps: new Map(),
      createdAt: new Date(),
      updatedAt: new Date(),
      context: {},
    };
    store.save(state);
    const entry = store.load("p1");
    expect(entry).toBeDefined();
    expect(entry!.pipelineId).toBe("p1");
  });

  it("should evict old checkpoints when max is reached", () => {
    const store = new InMemoryCheckpointStore(3);
    const state = {
      id: "p1",
      name: "t",
      status: "running" as const,
      steps: new Map(),
      createdAt: new Date(),
      updatedAt: new Date(),
      context: {},
    };
    for (let i = 0; i < 5; i++) store.save(state);
    expect(store.listCheckpoints("p1").length).toBe(3);
  });
});

// ── RollbackHandler ──────────────────────────────────────────────────────────

describe("RollbackHandler", () => {
  it("should call compensators in LIFO order", async () => {
    const order: string[] = [];
    const handler = new RollbackHandler();
    handler.register("step-1", async () => {
      order.push("step-1");
    });
    handler.register("step-2", async () => {
      order.push("step-2");
    });

    const now = new Date();
    const state = {
      id: "p1",
      name: "t",
      status: "failed" as const,
      steps: new Map([
        [
          "step-1",
          {
            definition: { name: "step-1" },
            status: "completed" as const,
            attempt: 1,
            completedAt: new Date(now.getTime() - 1000),
            output: "out1",
          },
        ],
        [
          "step-2",
          {
            definition: { name: "step-2" },
            status: "completed" as const,
            attempt: 1,
            completedAt: now,
            output: "out2",
          },
        ],
      ]),
      createdAt: now,
      updatedAt: now,
      context: {},
    };

    const result = await handler.rollback(state);
    expect(result.rolledBackSteps).toContain("step-1");
    expect(result.rolledBackSteps).toContain("step-2");
    // LIFO: step-2 (completed later) should be rolled back first
    expect(order[0]).toBe("step-2");
    expect(order[1]).toBe("step-1");
  });

  it("should skip steps with no compensator", async () => {
    const handler = new RollbackHandler();
    const now = new Date();
    const state = {
      id: "p1",
      name: "t",
      status: "failed" as const,
      steps: new Map([
        [
          "step-x",
          {
            definition: { name: "step-x" },
            status: "completed" as const,
            attempt: 1,
            completedAt: now,
            output: null,
          },
        ],
      ]),
      createdAt: now,
      updatedAt: now,
      context: {},
    };
    const result = await handler.rollback(state);
    expect(result.skippedSteps).toContain("step-x");
    expect(result.rolledBackSteps.length).toBe(0);
  });
});
