import { describe, it, expect, beforeEach } from "vitest";
import { PromptTracker } from "../../packages/learning/src/prompt-tracker.js";

describe("PromptTracker", () => {
  let tracker: PromptTracker;

  beforeEach(() => {
    tracker = new PromptTracker();
  });

  it("should record a usage entry with an auto-generated id", () => {
    const record = tracker.recordUsage({
      templateKey: "summarise",
      templateVersion: 1,
      interactionId: "i1",
    });

    expect(record.id).toBeDefined();
    expect(record.templateKey).toBe("summarise");
  });

  it("should record an outcome for a usage record", () => {
    const usage = tracker.recordUsage({
      templateKey: "summarise",
      templateVersion: 1,
      interactionId: "i1",
    });

    const outcome = tracker.recordOutcome(usage.id, 0.9);
    expect(outcome.score).toBe(0.9);
    expect(outcome.templateKey).toBe("summarise");
    expect(outcome.templateVersion).toBe(1);
  });

  it("should clamp outcome score to [0, 1]", () => {
    const usage = tracker.recordUsage({ templateKey: "k", templateVersion: 1, interactionId: "i" });
    expect(tracker.recordOutcome(usage.id, 1.5).score).toBe(1);
    const usage2 = tracker.recordUsage({
      templateKey: "k",
      templateVersion: 1,
      interactionId: "i2",
    });
    expect(tracker.recordOutcome(usage2.id, -0.5).score).toBe(0);
  });

  it("should throw when recording outcome for unknown usage id", () => {
    expect(() => tracker.recordOutcome("non-existent", 0.5)).toThrow();
  });

  it("should compute version stats including mean score", () => {
    const u1 = tracker.recordUsage({ templateKey: "k", templateVersion: 1, interactionId: "i1" });
    const u2 = tracker.recordUsage({ templateKey: "k", templateVersion: 1, interactionId: "i2" });
    const u3 = tracker.recordUsage({ templateKey: "k", templateVersion: 2, interactionId: "i3" });

    tracker.recordOutcome(u1.id, 0.8);
    tracker.recordOutcome(u2.id, 0.6);
    tracker.recordOutcome(u3.id, 0.9);

    const stats = tracker.getVersionStats("k");
    expect(stats).toHaveLength(2);

    const v1 = stats.find((s) => s.version === 1)!;
    expect(v1.usageCount).toBe(2);
    expect(v1.scoredCount).toBe(2);
    expect(v1.meanScore).toBeCloseTo(0.7);

    const v2 = stats.find((s) => s.version === 2)!;
    expect(v2.meanScore).toBeCloseTo(0.9);
  });

  it("should filter usage and outcome records by template key", () => {
    const u1 = tracker.recordUsage({ templateKey: "a", templateVersion: 1, interactionId: "i1" });
    tracker.recordUsage({ templateKey: "b", templateVersion: 1, interactionId: "i2" });
    tracker.recordOutcome(u1.id, 0.7);

    expect(tracker.getUsageRecords("a")).toHaveLength(1);
    expect(tracker.getUsageRecords("b")).toHaveLength(1);
    expect(tracker.getOutcomeRecords("a")).toHaveLength(1);
    expect(tracker.getOutcomeRecords("b")).toHaveLength(0);
  });

  it("should evict oldest records when maxUsageRecords is exceeded", () => {
    const small = new PromptTracker({ maxUsageRecords: 3 });
    for (let i = 0; i < 5; i++) {
      small.recordUsage({ templateKey: "k", templateVersion: 1, interactionId: `i${i}` });
    }
    expect(small.getUsageRecords("k")).toHaveLength(3);
  });

  it("should evict oldest outcomes when maxOutcomeRecords is exceeded", () => {
    const small = new PromptTracker({ maxOutcomeRecords: 3 });

    for (let i = 0; i < 5; i++) {
      const usage = small.recordUsage({
        templateKey: "k",
        templateVersion: 1,
        interactionId: `i${i}`,
      });
      small.recordOutcome(usage.id, i / 10);
    }

    const outcomes = small.getOutcomeRecords("k");
    expect(outcomes).toHaveLength(3);
    expect(outcomes.map((r) => r.score)).toEqual([0.2, 0.3, 0.4]);

    const [stats] = small.getVersionStats("k");
    expect(stats.scoredCount).toBe(3);
    expect(stats.meanScore).toBeCloseTo(0.3);
  });
});
