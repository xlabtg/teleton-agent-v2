import { describe, it, expect, beforeEach } from "vitest";
import { AbTesting } from "../../packages/learning/src/ab-testing.js";

describe("AbTesting", () => {
  let ab: AbTesting;

  beforeEach(() => {
    ab = new AbTesting({ minDeltaForSignificance: 0.1 });
  });

  function createBasicExperiment() {
    return ab.createExperiment({
      name: "test-exp",
      description: "A test experiment",
      variants: [
        { key: "control", weight: 0.5, payload: { strategyId: "s0" } },
        { key: "treatment", weight: 0.5, payload: { strategyId: "s1" } },
      ],
    });
  }

  it("should create an experiment in running state", () => {
    const exp = createBasicExperiment();
    expect(exp.id).toBeDefined();
    expect(exp.status).toBe("running");
    expect(exp.variants).toHaveLength(2);
  });

  it("should reject experiments with weights not summing to 1", () => {
    expect(() =>
      ab.createExperiment({
        name: "bad",
        description: "",
        variants: [
          { key: "a", weight: 0.3, payload: {} },
          { key: "b", weight: 0.3, payload: {} },
        ],
      })
    ).toThrow();
  });

  it("should assign users to variants deterministically", () => {
    const exp = createBasicExperiment();
    const v1 = ab.assignVariant(exp.id, "user-42");
    const v2 = ab.assignVariant(exp.id, "user-42");

    expect(v1.key).toBe(v2.key);
  });

  it("should record exposures only once per user", () => {
    const exp = createBasicExperiment();
    ab.assignVariant(exp.id, "user-a");
    ab.assignVariant(exp.id, "user-a");

    const exposures = ab.getExposures(exp.id);
    expect(exposures.filter((e) => e.userId === "user-a")).toHaveLength(1);
  });

  it("should record outcomes and compute conversion rates", () => {
    const exp = createBasicExperiment();

    // Assign 3 users and record outcomes
    ab.assignVariant(exp.id, "u1");
    ab.assignVariant(exp.id, "u2");
    ab.assignVariant(exp.id, "u3");

    ab.recordOutcome(exp.id, "u1", true);
    ab.recordOutcome(exp.id, "u2", false);
    ab.recordOutcome(exp.id, "u3", true);

    const results = ab.getResults(exp.id);
    expect(results.variantStats.length).toBe(2);

    const totalOutcomes = results.variantStats.reduce(
      (s, v) => s + v.positiveOutcomes + v.negativeOutcomes,
      0
    );
    expect(totalOutcomes).toBe(3);
  });

  it("should throw when recording outcome for unassigned user", () => {
    const exp = createBasicExperiment();
    expect(() => ab.recordOutcome(exp.id, "ghost-user", true)).toThrow();
  });

  it("should pause and resume experiments", () => {
    const exp = createBasicExperiment();
    ab.pauseExperiment(exp.id);
    expect(ab.getExperiment(exp.id)!.status).toBe("paused");

    expect(() => ab.assignVariant(exp.id, "u1")).toThrow();

    ab.resumeExperiment(exp.id);
    expect(ab.getExperiment(exp.id)!.status).toBe("running");
    expect(() => ab.assignVariant(exp.id, "u1")).not.toThrow();
  });

  it("should conclude an experiment with a winner", () => {
    const exp = createBasicExperiment();
    ab.concludeExperiment(exp.id, "control");

    const concluded = ab.getExperiment(exp.id)!;
    expect(concluded.status).toBe("concluded");
    expect(concluded.winner).toBe("control");
    expect(concluded.concludedAt).toBeDefined();
  });

  it("should report hasSignificantWinner correctly", () => {
    const exp = ab.createExperiment({
      name: "perf-test",
      description: "",
      variants: [
        { key: "control", weight: 0.5, payload: {} },
        { key: "treatment", weight: 0.5, payload: {} },
      ],
    });

    // Force all users to known variants by examining the assignment
    const users = Array.from({ length: 20 }, (_, i) => `user-${i}`);
    for (const u of users) {
      ab.assignVariant(exp.id, u);
    }

    const exposures = ab.getExposures(exp.id);
    const controlUsers = exposures.filter((e) => e.variantKey === "control").map((e) => e.userId);
    const treatmentUsers = exposures
      .filter((e) => e.variantKey === "treatment")
      .map((e) => e.userId);

    // Give treatment 100% positive, control 0%
    for (const u of controlUsers) ab.recordOutcome(exp.id, u, false);
    for (const u of treatmentUsers) ab.recordOutcome(exp.id, u, true);

    const results = ab.getResults(exp.id);
    if (controlUsers.length > 0 && treatmentUsers.length > 0) {
      expect(results.hasSignificantWinner).toBe(true);
    }
  });
});
