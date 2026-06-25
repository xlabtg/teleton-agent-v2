import { describe, it, expect, beforeEach } from "vitest";
import { TaskDecomposer } from "../../packages/agents/src/task-decomposer.js";
import { CapabilityMatcher } from "../../packages/agents/src/capability-matcher.js";
import { DelegationRouter } from "../../packages/agents/src/delegation-router.js";
import { ResultAggregator } from "../../packages/agents/src/result-aggregator.js";
import { AgentRegistry } from "../../packages/agents/src/agent-registry.js";

// ── TaskDecomposer ───────────────────────────────────────────────────────────

describe("TaskDecomposer", () => {
  const decomposer = new TaskDecomposer();

  it("should produce a single subtask for simple payloads (fast path)", () => {
    const result = decomposer.decompose("task-1", "greet", { message: "hello" });
    expect(result.isFastPath).toBe(true);
    expect(result.subtasks.length).toBe(1);
    expect(result.subtasks[0].name).toBe("greet");
  });

  it("should produce multiple subtasks for complex payloads", () => {
    const result = decomposer.decompose("task-2", "analyze", { code: "...", docs: "..." });
    expect(result.isFastPath).toBe(false);
    expect(result.subtasks.length).toBe(2);
  });

  it("should map default strategy slugs to allowed capability names", () => {
    const validating = new TaskDecomposer({
      allowedCapabilities: ["summarize-report", "user-prefs"],
    });

    const simple = validating.decompose("task-3", "Summarize report", { text: "..." });
    expect(simple.subtasks[0].requiredCapability).toBe("summarize-report");

    const complex = validating.decompose("task-4", "configure", {
      "user prefs": {},
      "summarize report": {},
    });
    expect(complex.subtasks.map((subtask) => subtask.requiredCapability)).toEqual([
      "user-prefs",
      "summarize-report",
    ]);
  });

  it("should fail during decomposition when a derived capability is not allowed", () => {
    const validating = new TaskDecomposer({ allowedCapabilities: ["code-review"] });

    expect(() => validating.decompose("task-5", "Summarize report", { text: "..." })).toThrow(
      'requiredCapability "summarize-report"'
    );
  });

  it("should use a custom strategy when provided", () => {
    const custom = new TaskDecomposer({
      strategy: (_name, _payload) => [
        {
          id: "x",
          name: "custom",
          description: "custom",
          requiredCapability: "custom",
          dependsOn: [],
          payload: {},
          priorityWeight: 100,
        },
      ],
    });
    const result = custom.decompose("t", "n", { a: 1, b: 2, c: 3 });
    expect(result.subtasks.length).toBe(1);
    expect(result.subtasks[0].name).toBe("custom");
  });
});

// ── CapabilityMatcher ────────────────────────────────────────────────────────

describe("CapabilityMatcher", () => {
  const matcher = new CapabilityMatcher();

  const agents = [
    {
      id: "a1",
      name: "A1",
      version: "1.0.0",
      namespace: "default",
      capabilities: [
        { name: "code-review", description: "", version: "1.0.0", tags: [], confidence: 0.9 },
      ],
      registeredAt: new Date(),
      updatedAt: new Date(),
      status: "healthy" as const,
      metadata: {},
    },
    {
      id: "a2",
      name: "A2",
      version: "1.0.0",
      namespace: "default",
      capabilities: [
        { name: "code-review", description: "", version: "1.0.0", tags: [], confidence: 0.5 },
      ],
      registeredAt: new Date(),
      updatedAt: new Date(),
      status: "degraded" as const,
      metadata: {},
    },
  ];

  it("should rank higher confidence agents first", () => {
    const results = matcher.rank(agents, "code-review");
    expect(results[0].agentId).toBe("a1");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("should exclude agents without the required capability", () => {
    const results = matcher.rank(agents, "ton-transfer");
    expect(results.length).toBe(0);
  });

  it("best() returns single top result", () => {
    const best = matcher.best(agents, "code-review");
    expect(best?.agentId).toBe("a1");
  });
});

// ── DelegationRouter ─────────────────────────────────────────────────────────

describe("DelegationRouter", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
    registry.register({
      id: "a1",
      name: "A1",
      version: "1.0.0",
      capabilities: [
        { name: "analyze", description: "", version: "1.0.0", tags: [], confidence: 0.8 },
      ],
    });
    registry.updateStatus("a1", "healthy");
    registry.register({
      id: "a2",
      name: "A2",
      version: "1.0.0",
      capabilities: [
        { name: "analyze", description: "", version: "1.0.0", tags: [], confidence: 0.6 },
      ],
    });
    registry.updateStatus("a2", "healthy");
  });

  it("best-fit strategy assigns highest score agent", () => {
    const router = new DelegationRouter(registry, { strategy: "best-fit" });
    const subtask = {
      id: "s1",
      name: "t",
      description: "",
      requiredCapability: "analyze",
      dependsOn: [],
      payload: {},
      priorityWeight: 50,
    };
    const decision = router.routeOne(subtask);
    expect(decision.assignedAgentId).toBe("a1");
  });

  it("returns null assignment when no capable agent", () => {
    const router = new DelegationRouter(registry);
    const subtask = {
      id: "s1",
      name: "t",
      description: "",
      requiredCapability: "unknown-cap",
      dependsOn: [],
      payload: {},
      priorityWeight: 50,
    };
    const decision = router.routeOne(subtask);
    expect(decision.assignedAgentId).toBeNull();
  });

  it("round-robin strategy cycles through agents", () => {
    const router = new DelegationRouter(registry, { strategy: "round-robin" });
    const subtask = (id: string) => ({
      id,
      name: "t",
      description: "",
      requiredCapability: "analyze",
      dependsOn: [],
      payload: {},
      priorityWeight: 50,
    });
    const d1 = router.routeOne(subtask("s1"));
    const d2 = router.routeOne(subtask("s2"));
    // Should alternate
    expect(d1.assignedAgentId).not.toBeNull();
    expect(d2.assignedAgentId).not.toBeNull();
    expect(d1.assignedAgentId).not.toBe(d2.assignedAgentId);
  });
});

// ── ResultAggregator ─────────────────────────────────────────────────────────

describe("ResultAggregator", () => {
  const result = (subtaskId: string, status: "success" | "failed" | "pending" | "skipped") => ({
    subtaskId,
    agentId: "a1",
    status,
    output: status === "success" ? { subtaskId } : null,
    durationMs: 10,
    completedAt: new Date(),
  });

  it("should produce successful aggregation when all subtasks succeed", () => {
    const agg = new ResultAggregator();
    const startedAt = new Date("2026-01-01T00:00:00.000Z").getTime();
    agg.record({
      subtaskId: "s1",
      agentId: "a1",
      status: "success",
      output: { x: 1 },
      durationMs: 100,
      completedAt: new Date(startedAt + 100),
    });
    agg.record({
      subtaskId: "s2",
      agentId: "a1",
      status: "success",
      output: { y: 2 },
      durationMs: 200,
      completedAt: new Date(startedAt + 300),
    });
    const result = agg.aggregate("task-1");
    expect(result.success).toBe(true);
    expect(result.failures.length).toBe(0);
    expect(Object.keys(result.outputs).length).toBe(2);
    expect(result.totalDurationMs).toBe(300);
  });

  it("should report wall-clock duration instead of summing overlapping subtask durations", () => {
    const agg = new ResultAggregator();
    const startedAt = new Date("2026-01-01T00:00:00.000Z").getTime();
    agg.record({
      subtaskId: "s1",
      agentId: "a1",
      status: "success",
      output: { x: 1 },
      durationMs: 1_000,
      completedAt: new Date(startedAt + 1_000),
    });
    agg.record({
      subtaskId: "s2",
      agentId: "a2",
      status: "success",
      output: { y: 2 },
      durationMs: 1_000,
      completedAt: new Date(startedAt + 1_200),
    });

    expect(agg.aggregate("task-1").totalDurationMs).toBe(1_200);
  });

  it("should fail when any subtask fails (failFast=true default)", () => {
    const agg = new ResultAggregator();
    agg.record({
      subtaskId: "s1",
      agentId: "a1",
      status: "success",
      output: {},
      durationMs: 50,
      completedAt: new Date(),
    });
    agg.record({
      subtaskId: "s2",
      agentId: "a1",
      status: "failed",
      output: null,
      error: "boom",
      durationMs: 50,
      completedAt: new Date(),
    });
    const result = agg.aggregate("task-1");
    expect(result.success).toBe(false);
    expect(result.failures).toContain("s2");
  });

  it("should tolerate partial failures when failFast=false", () => {
    const agg = new ResultAggregator({ failFast: false });
    agg.record({
      subtaskId: "s1",
      agentId: "a1",
      status: "success",
      output: {},
      durationMs: 50,
      completedAt: new Date(),
    });
    agg.record({
      subtaskId: "s2",
      agentId: "a1",
      status: "failed",
      output: null,
      durationMs: 50,
      completedAt: new Date(),
    });
    agg.record({
      subtaskId: "s3",
      agentId: "a1",
      status: "success",
      output: {},
      durationMs: 50,
      completedAt: new Date(),
    });
    const result = agg.aggregate("task-1");
    expect(result.success).toBe(true); // majority succeeded
  });

  it("should fail with failFast=false when only one of many subtasks succeeds", () => {
    const agg = new ResultAggregator({ failFast: false });
    agg.record(result("s1", "success"));
    agg.record(result("s2", "failed"));
    agg.record(result("s3", "failed"));
    agg.record(result("s4", "failed"));

    expect(agg.aggregate("task-1").success).toBe(false);
  });

  it("should fail with failFast=false when exactly half of subtasks succeed", () => {
    const agg = new ResultAggregator({ failFast: false });
    agg.record(result("s1", "success"));
    agg.record(result("s2", "success"));
    agg.record(result("s3", "failed"));
    agg.record(result("s4", "failed"));

    expect(agg.aggregate("task-1").success).toBe(false);
  });

  it("should succeed with failFast=false when a majority of subtasks succeed", () => {
    const agg = new ResultAggregator({ failFast: false });
    agg.record(result("s1", "success"));
    agg.record(result("s2", "success"));
    agg.record(result("s3", "success"));
    agg.record(result("s4", "failed"));

    expect(agg.aggregate("task-1").success).toBe(true);
  });

  it("should not count pending or skipped subtasks as successes for majority", () => {
    const agg = new ResultAggregator({ failFast: false });
    agg.record(result("s1", "success"));
    agg.record(result("s2", "pending"));
    agg.record(result("s3", "skipped"));

    expect(agg.aggregate("task-1").success).toBe(false);
  });

  it("should still require all subtasks to avoid failure when failFast=true", () => {
    const agg = new ResultAggregator({ failFast: true });
    agg.record(result("s1", "success"));
    agg.record(result("s2", "success"));
    agg.record(result("s3", "failed"));

    expect(agg.aggregate("task-1").success).toBe(false);
  });

  it("reset clears all records", () => {
    const agg = new ResultAggregator();
    agg.record({
      subtaskId: "s1",
      agentId: "a1",
      status: "success",
      output: {},
      durationMs: 10,
      completedAt: new Date(),
    });
    agg.reset();
    expect(agg.count).toBe(0);
  });
});
