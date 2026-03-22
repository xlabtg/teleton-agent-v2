import { describe, it, expect, beforeEach } from "vitest";
import { BehaviorTracker } from "../../packages/intelligence/src/behavior-tracker.js";
import { PatternMiner } from "../../packages/intelligence/src/pattern-miner.js";
import { PredictionEvaluator } from "../../packages/intelligence/src/prediction-evaluator.js";
import { PredictionEngine } from "../../packages/intelligence/src/prediction-engine.js";
import type { BehavioralEvent } from "../../packages/intelligence/src/behavior-tracker.js";

function makeEvent(action: BehavioralEvent["action"]): Omit<BehavioralEvent, "id"> {
  return { userId: "u1", action, context: {}, timestamp: new Date() };
}

describe("PredictionEngine", () => {
  let tracker: BehaviorTracker;
  let miner: PatternMiner;
  let evaluator: PredictionEvaluator;
  let engine: PredictionEngine;

  beforeEach(() => {
    tracker = new BehaviorTracker();
    miner = new PatternMiner({ minSupport: 2, maxSequenceLength: 3 });
    evaluator = new PredictionEvaluator();
    engine = new PredictionEngine(tracker, miner, evaluator, { confidenceThreshold: 0.01 });
  });

  it("should return empty predictions for a new user", () => {
    expect(engine.predict("u1")).toEqual([]);
  });

  it("should return empty predictions for opted-out users", () => {
    tracker.record(makeEvent("message_sent"));
    tracker.optOut("u1");
    expect(engine.predict("u1")).toEqual([]);
  });

  it("should predict next action from recurring pattern", () => {
    // Establish pattern: message_sent → query_submitted (repeated)
    for (let i = 0; i < 3; i++) {
      tracker.record(makeEvent("message_sent"));
      tracker.record(makeEvent("query_submitted"));
    }
    // Add one more message_sent so context tail ends with it
    tracker.record(makeEvent("message_sent"));
    // Engine should predict query_submitted as the next action
    const predictions = engine.predict("u1");
    const predicted = predictions.find((p) => p.action === "query_submitted");
    expect(predicted).toBeDefined();
    expect(predicted!.confidence).toBeGreaterThan(0);
  });

  it("should honour confidence threshold", () => {
    const strictEngine = new PredictionEngine(tracker, miner, evaluator, {
      confidenceThreshold: 0.99,
    });
    for (let i = 0; i < 3; i++) {
      tracker.record(makeEvent("message_sent"));
      tracker.record(makeEvent("query_submitted"));
    }
    // With extremely high threshold nothing should pass
    const predictions = strictEngine.predict("u1");
    expect(predictions).toHaveLength(0);
  });

  it("should track predictions and allow feedback resolution", () => {
    for (let i = 0; i < 3; i++) {
      tracker.record(makeEvent("message_sent"));
      tracker.record(makeEvent("query_submitted"));
    }
    const { predictions, trackingIds } = engine.predictAndTrack("u1");

    if (predictions.length > 0) {
      const id = trackingIds[0];
      engine.feedback(id, predictions[0].action);

      const summary = evaluator.summarize("u1");
      expect(summary.resolvedPredictions).toBeGreaterThanOrEqual(1);
      expect(summary.correctPredictions).toBeGreaterThanOrEqual(1);
    }
  });

  it("should limit predictions to maxPredictions", () => {
    const limitedEngine = new PredictionEngine(tracker, miner, evaluator, {
      confidenceThreshold: 0.01,
      maxPredictions: 1,
    });

    for (let i = 0; i < 3; i++) {
      tracker.record(makeEvent("message_sent"));
      tracker.record(makeEvent("query_submitted"));
      tracker.record(makeEvent("tool_used"));
    }

    const predictions = limitedEngine.predict("u1");
    expect(predictions.length).toBeLessThanOrEqual(1);
  });
});
