import { describe, it, expect, beforeEach } from "vitest";
import { StrategyAdjuster } from "../../packages/learning/src/strategy-adjuster.js";

describe("StrategyAdjuster", () => {
  let adjuster: StrategyAdjuster;

  beforeEach(() => {
    adjuster = new StrategyAdjuster();
  });

  it("should register and activate a strategy", () => {
    const strategy = adjuster.registerStrategy({
      label: "strategy-v1",
      promptOverrides: [{ templateKey: "greet", template: "Hello, {{name}}!" }],
      toolPreferences: [{ toolName: "web-search", preference: "prefer" }],
      routingHints: [{ actionCategory: "summarise", preferredAgentId: "agent-summariser" }],
    });

    expect(strategy.id).toBeDefined();
    expect(adjuster.getActiveStrategy()).toBeNull();

    adjuster.applyStrategy(strategy.id, "initial setup");
    expect(adjuster.getActiveStrategy()?.id).toBe(strategy.id);
  });

  it("should resolve prompt template from active strategy", () => {
    const strategy = adjuster.registerStrategy({
      label: "s1",
      promptOverrides: [{ templateKey: "greet", template: "Hi, {{name}}!" }],
      toolPreferences: [],
      routingHints: [],
    });
    adjuster.applyStrategy(strategy.id, "test");

    expect(adjuster.resolvePromptTemplate("greet", "Hello!")).toBe("Hi, {{name}}!");
    expect(adjuster.resolvePromptTemplate("unknown", "default")).toBe("default");
  });

  it("should resolve tool preference", () => {
    const strategy = adjuster.registerStrategy({
      label: "s1",
      promptOverrides: [],
      toolPreferences: [{ toolName: "calculator", preference: "avoid" }],
      routingHints: [],
    });
    adjuster.applyStrategy(strategy.id, "test");

    expect(adjuster.resolveToolPreference("calculator")).toBe("avoid");
    expect(adjuster.resolveToolPreference("web-search")).toBe("neutral");
  });

  it("should resolve preferred agent", () => {
    const strategy = adjuster.registerStrategy({
      label: "s1",
      promptOverrides: [],
      toolPreferences: [],
      routingHints: [{ actionCategory: "translate", preferredAgentId: "translator" }],
    });
    adjuster.applyStrategy(strategy.id, "test");

    expect(adjuster.resolvePreferredAgent("translate")).toBe("translator");
    expect(adjuster.resolvePreferredAgent("summarise")).toBeNull();
  });

  it("should support rollback to previous strategy", () => {
    const s1 = adjuster.registerStrategy({
      label: "s1",
      promptOverrides: [],
      toolPreferences: [],
      routingHints: [],
    });
    const s2 = adjuster.registerStrategy({
      label: "s2",
      promptOverrides: [],
      toolPreferences: [],
      routingHints: [],
    });

    adjuster.applyStrategy(s1.id, "apply s1");
    adjuster.applyStrategy(s2.id, "apply s2");

    adjuster.rollback("rollback test");

    expect(adjuster.getActiveStrategy()?.id).toBe(s1.id);
  });

  it("should throw when activating unknown strategy", () => {
    expect(() => adjuster.applyStrategy("non-existent", "test")).toThrow();
  });

  it("should return adjustment history newest first", () => {
    const s1 = adjuster.registerStrategy({
      label: "s1",
      promptOverrides: [],
      toolPreferences: [],
      routingHints: [],
    });
    const s2 = adjuster.registerStrategy({
      label: "s2",
      promptOverrides: [],
      toolPreferences: [],
      routingHints: [],
    });

    adjuster.applyStrategy(s1.id, "first");
    adjuster.applyStrategy(s2.id, "second");

    const history = adjuster.getAdjustmentHistory();
    expect(history[0].reason).toBe("second");
    expect(history[1].reason).toBe("first");
  });
});
