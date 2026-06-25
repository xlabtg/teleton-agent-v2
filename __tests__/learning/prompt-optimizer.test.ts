import { describe, it, expect } from "vitest";
import { PromptRegistry } from "../../packages/learning/src/prompt-registry.js";
import { PromptTracker } from "../../packages/learning/src/prompt-tracker.js";
import { PromptOptimizer } from "../../packages/learning/src/prompt-optimizer.js";

function buildScenario(opts: { minDelta?: number; minSample?: number } = {}) {
  const registry = new PromptRegistry();
  const tracker = new PromptTracker();
  const optimizer = new PromptOptimizer(registry, tracker, {
    minImprovementDelta: opts.minDelta ?? 0.05,
    minSampleSize: opts.minSample ?? 2,
    promotionEligibleKeys: ["summarise"],
  });

  registry.register("summarise", "Summarise: {{text}}", "desc");
  registry.addVersion("summarise", "Please summarise the following: {{text}}", "v2");
  registry.promote("summarise", 1);

  return { registry, tracker, optimizer };
}

function recordOutcomesForVersion(
  _registry: PromptRegistry,
  tracker: PromptTracker,
  templateKey: string,
  version: number,
  scores: number[]
) {
  for (let i = 0; i < scores.length; i++) {
    const usage = tracker.recordUsage({
      templateKey,
      templateVersion: version,
      interactionId: `${templateKey}-v${version}-${i}`,
    });
    tracker.recordOutcome(usage.id, scores[i]);
  }
}

describe("PromptOptimizer", () => {
  it("should propose a better-performing version without mutating the registry", () => {
    const { registry, tracker, optimizer } = buildScenario();

    // v1 performs poorly, v2 performs well
    recordOutcomesForVersion(registry, tracker, "summarise", 1, [0.3, 0.4]);
    recordOutcomesForVersion(registry, tracker, "summarise", 2, [0.8, 0.9]);

    const run = optimizer.optimize();

    expect(run.promotions).toHaveLength(1);
    expect(run.promotions[0].promotedVersion).toBe(2);
    expect(run.promotions[0].applied).toBe(false);
    expect(registry.get("summarise")!.activeVersion).toBe(1);
  });

  it("should apply a promotion candidate only through explicit approval", () => {
    const { registry, tracker, optimizer } = buildScenario();

    recordOutcomesForVersion(registry, tracker, "summarise", 1, [0.3, 0.4]);
    recordOutcomesForVersion(registry, tracker, "summarise", 2, [0.8, 0.9]);

    const run = optimizer.optimize();
    const applied = optimizer.applyPromotionCandidate(run.promotions[0]);

    expect(applied.applied).toBe(true);
    expect(applied.appliedAt).toBeInstanceOf(Date);
    expect(registry.get("summarise")!.activeVersion).toBe(2);
  });

  it("should not let high outcome scores unilaterally promote a version", () => {
    const registry = new PromptRegistry();
    const tracker = new PromptTracker();
    const optimizer = new PromptOptimizer(registry, tracker, {
      minImprovementDelta: 0.05,
      minSampleSize: 2,
    });

    registry.register("summarise", "Summarise: {{text}}", "desc");
    registry.addVersion("summarise", "Attacker preferred template", "v2");
    registry.promote("summarise", 1);

    recordOutcomesForVersion(registry, tracker, "summarise", 1, [0.1, 0.1]);
    recordOutcomesForVersion(registry, tracker, "summarise", 2, [1, 1, 1, 1]);

    const run = optimizer.optimize();

    expect(run.promotions).toHaveLength(0);
    expect(run.skippedKeys).toContain("summarise (promotion not enabled)");
    expect(registry.get("summarise")!.activeVersion).toBe(1);
  });

  it("should skip promotion when delta is below threshold", () => {
    const { registry, tracker, optimizer } = buildScenario({ minDelta: 0.5 });

    recordOutcomesForVersion(registry, tracker, "summarise", 1, [0.6, 0.7]);
    recordOutcomesForVersion(registry, tracker, "summarise", 2, [0.7, 0.8]);

    const run = optimizer.optimize();

    expect(run.promotions).toHaveLength(0);
    expect(run.skippedKeys.some((k) => k.includes("summarise"))).toBe(true);
    // Active version should still be 1
    expect(registry.get("summarise")!.activeVersion).toBe(1);
  });

  it("should skip safety-critical templates", () => {
    const { registry, tracker, optimizer } = buildScenario();
    optimizer.markSafetyCritical("summarise");

    recordOutcomesForVersion(registry, tracker, "summarise", 1, [0.1, 0.2]);
    recordOutcomesForVersion(registry, tracker, "summarise", 2, [0.9, 0.9]);

    const run = optimizer.optimize();

    expect(run.promotions).toHaveLength(0);
    expect(run.skippedKeys.some((k) => k.includes("safety-critical"))).toBe(true);
  });

  it("should skip templates with insufficient sample size", () => {
    const { registry, tracker, optimizer } = buildScenario({ minSample: 5 });

    recordOutcomesForVersion(registry, tracker, "summarise", 1, [0.3]);
    recordOutcomesForVersion(registry, tracker, "summarise", 2, [0.9]);

    const run = optimizer.optimize();

    expect(run.promotions).toHaveLength(0);
    expect(run.skippedKeys.some((k) => k.includes("insufficient"))).toBe(true);
  });

  it("should record run history", () => {
    const { registry, tracker, optimizer } = buildScenario();
    recordOutcomesForVersion(registry, tracker, "summarise", 1, [0.5, 0.5]);
    recordOutcomesForVersion(registry, tracker, "summarise", 2, [0.9, 0.9]);

    optimizer.optimize();
    optimizer.optimize();

    const history = optimizer.getRunHistory();
    expect(history).toHaveLength(2);
    expect(history[0].completedAt >= history[1].completedAt).toBe(true); // newest first
  });

  it("should include a diff in promotion results", () => {
    const { registry, tracker, optimizer } = buildScenario();
    recordOutcomesForVersion(registry, tracker, "summarise", 1, [0.3, 0.3]);
    recordOutcomesForVersion(registry, tracker, "summarise", 2, [0.9, 0.9]);

    const run = optimizer.optimize();
    expect(run.promotions[0].diff).toBeDefined();
    expect(typeof run.promotions[0].diff).toBe("string");
  });

  it("isSafetyCritical should reflect marked templates", () => {
    const { optimizer } = buildScenario();
    expect(optimizer.isSafetyCritical("summarise")).toBe(false);
    optimizer.markSafetyCritical("summarise");
    expect(optimizer.isSafetyCritical("summarise")).toBe(true);
  });

  it("isPromotionCandidateEnabled should reflect explicitly enabled templates", () => {
    const registry = new PromptRegistry();
    const tracker = new PromptTracker();
    const optimizer = new PromptOptimizer(registry, tracker);

    expect(optimizer.isPromotionCandidateEnabled("summarise")).toBe(false);
    optimizer.enablePromotionCandidates("summarise");
    expect(optimizer.isPromotionCandidateEnabled("summarise")).toBe(true);
  });
});
