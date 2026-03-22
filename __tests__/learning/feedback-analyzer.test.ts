import { describe, it, expect, beforeEach } from "vitest";
import { FeedbackCollector } from "../../packages/learning/src/feedback-collector.js";
import { FeedbackAnalyzer } from "../../packages/learning/src/feedback-analyzer.js";

function makeCollector() {
  const collector = new FeedbackCollector();

  const entries = [
    {
      interactionId: "i1",
      userId: "u1",
      agentId: "agent-a",
      actionCategory: "summarise",
      feedback: { type: "explicit" as const, rating: "thumbs_up" as const },
    },
    {
      interactionId: "i2",
      userId: "u1",
      agentId: "agent-a",
      actionCategory: "summarise",
      feedback: { type: "explicit" as const, rating: "thumbs_down" as const },
    },
    {
      interactionId: "i3",
      userId: "u2",
      agentId: "agent-b",
      actionCategory: "translate",
      feedback: { type: "implicit" as const, signal: "retry" as const },
    },
    {
      interactionId: "i4",
      userId: "u2",
      agentId: "agent-b",
      actionCategory: "translate",
      feedback: { type: "explicit" as const, rating: "thumbs_up" as const },
    },
    {
      interactionId: "i5",
      userId: "u3",
      agentId: "agent-a",
      actionCategory: "summarise",
      feedback: { type: "explicit" as const, rating: "thumbs_up" as const },
    },
  ];

  for (const e of entries) {
    collector.collect(e);
  }

  return collector;
}

describe("FeedbackAnalyzer", () => {
  let collector: FeedbackCollector;
  let analyzer: FeedbackAnalyzer;

  beforeEach(() => {
    collector = makeCollector();
    analyzer = new FeedbackAnalyzer(collector);
  });

  it("should compute category stats", () => {
    const stats = analyzer.analyzeByCategory();
    const summarise = stats.find((s) => s.actionCategory === "summarise");
    const translate = stats.find((s) => s.actionCategory === "translate");

    expect(summarise).toBeDefined();
    expect(summarise!.total).toBe(3);
    expect(summarise!.positiveCount).toBe(2);
    expect(summarise!.negativeCount).toBe(1); // thumbs_down
    expect(summarise!.satisfactionRate).toBeCloseTo(2 / 3);

    expect(translate).toBeDefined();
    expect(translate!.total).toBe(2);
    expect(translate!.implicitNegativeCount).toBe(1); // retry
  });

  it("should compute agent stats", () => {
    const stats = analyzer.analyzeByAgent();
    const agentA = stats.find((s) => s.agentId === "agent-a");
    const agentB = stats.find((s) => s.agentId === "agent-b");

    expect(agentA).toBeDefined();
    expect(agentA!.total).toBe(3);

    expect(agentB).toBeDefined();
    expect(agentB!.total).toBe(2);
  });

  it("should return categories with low satisfaction rate", () => {
    const low = analyzer.lowSatisfactionCategories(0.6);
    // translate: 1 positive out of 2 = 0.5 < 0.6
    expect(low.some((s) => s.actionCategory === "translate")).toBe(true);
  });

  it("should generate a full report", () => {
    const report = analyzer.report();
    expect(report.totalEntries).toBe(5);
    expect(report.overallSatisfactionRate).toBeCloseTo(3 / 5);
    expect(report.byCategory.length).toBeGreaterThan(0);
    expect(report.byAgent.length).toBeGreaterThan(0);
  });

  it("should respect minSampleSize", () => {
    const strictAnalyzer = new FeedbackAnalyzer(collector, { minSampleSize: 4 });
    const stats = strictAnalyzer.analyzeByCategory();
    // Only 'summarise' has 3 entries which is < 4, so nothing should be included
    expect(stats).toHaveLength(0);
  });
});
