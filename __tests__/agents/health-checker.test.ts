import { describe, it, expect, beforeEach } from "vitest";
import { AgentRegistry } from "../../packages/agents/src/agent-registry.js";
import { HealthChecker } from "../../packages/agents/src/health-checker.js";

function makeRegistry() {
  const registry = new AgentRegistry();
  registry.register({ id: "a1", name: "A1", version: "1.0.0", capabilities: [] });
  registry.register({ id: "a2", name: "A2", version: "1.0.0", capabilities: [] });
  return registry;
}

describe("HealthChecker", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = makeRegistry();
  });

  it("should mark agents healthy when probe succeeds", async () => {
    const checker = new HealthChecker(registry, { probe: async () => true });
    await checker.runChecks();
    expect(registry.get("a1").status).toBe("healthy");
    expect(registry.get("a2").status).toBe("healthy");
  });

  it("should mark agent degraded after one failure", async () => {
    const checker = new HealthChecker(registry, { probe: async () => false, failureThreshold: 3 });
    await checker.checkAgent("a1");
    expect(registry.get("a1").status).toBe("degraded");
    expect(checker.getState("a1")?.consecutiveFailures).toBe(1);
  });

  it("should mark agent unhealthy after threshold failures", async () => {
    const checker = new HealthChecker(registry, { probe: async () => false, failureThreshold: 2 });
    await checker.checkAgent("a1");
    await checker.checkAgent("a1");
    expect(registry.get("a1").status).toBe("unhealthy");
  });

  it("should reset failure count after a successful check", async () => {
    let callCount = 0;
    const probe = async () => callCount++ >= 2; // fail first 2, then succeed
    const checker = new HealthChecker(registry, { probe, failureThreshold: 5 });
    await checker.checkAgent("a1");
    await checker.checkAgent("a1");
    await checker.checkAgent("a1"); // success
    expect(checker.getState("a1")?.consecutiveFailures).toBe(0);
    expect(registry.get("a1").status).toBe("healthy");
  });

  it("should auto-deregister unhealthy agents when configured", async () => {
    const checker = new HealthChecker(registry, {
      probe: async () => false,
      failureThreshold: 1,
      autoDeregister: true,
    });
    await checker.checkAgent("a1");
    expect(registry.size).toBe(1); // a1 was deregistered
  });

  it("start and stop control the polling loop", () => {
    const checker = new HealthChecker(registry, { intervalMs: 60_000 });
    expect(checker.isRunning).toBe(false);
    checker.start();
    expect(checker.isRunning).toBe(true);
    checker.stop();
    expect(checker.isRunning).toBe(false);
  });

  it("start is idempotent", () => {
    const checker = new HealthChecker(registry, { intervalMs: 60_000 });
    checker.start();
    checker.start(); // should not throw or create a second timer
    expect(checker.isRunning).toBe(true);
    checker.stop();
  });
});
