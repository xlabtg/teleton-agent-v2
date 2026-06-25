import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentRegistry } from "../../packages/agents/src/agent-registry.js";
import { HealthChecker, type HealthProbe } from "../../packages/agents/src/health-checker.js";

function makeRegistry() {
  const registry = new AgentRegistry();
  registry.register({ id: "a1", name: "A1", version: "1.0.0", capabilities: [] });
  registry.register({ id: "a2", name: "A2", version: "1.0.0", capabilities: [] });
  return registry;
}

function sequenceProbe(results: boolean[]): HealthProbe {
  let index = 0;
  return async () => {
    const result = results[index];
    index += 1;
    return result ?? results[results.length - 1] ?? true;
  };
}

describe("HealthChecker", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = makeRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("should reset failure count after a successful recovery check", async () => {
    const checker = new HealthChecker(registry, {
      probe: sequenceProbe([false, false, true]),
      failureThreshold: 5,
      recoveryThreshold: 1,
    });
    await checker.checkAgent("a1");
    await checker.checkAgent("a1");
    await checker.checkAgent("a1"); // success
    expect(checker.getState("a1")?.consecutiveFailures).toBe(0);
    expect(registry.get("a1").status).toBe("healthy");
  });

  it("should keep a flapping agent degraded until the recovery threshold is met", async () => {
    const checker = new HealthChecker(registry, {
      probe: sequenceProbe([false, true, false, true, true]),
      failureThreshold: 2,
      recoveryThreshold: 2,
    });

    await expect(checker.checkAgent("a1")).resolves.toBe("degraded");
    await expect(checker.checkAgent("a1")).resolves.toBe("degraded");
    await expect(checker.checkAgent("a1")).resolves.toBe("degraded");
    await expect(checker.checkAgent("a1")).resolves.toBe("degraded");
    await expect(checker.checkAgent("a1")).resolves.toBe("healthy");
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

  it("does not start a second scheduled round while the previous round is still running", async () => {
    vi.useFakeTimers();
    const resolveProbes: Array<() => void> = [];
    const probe = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveProbes.push(() => resolve(true));
        })
    );
    const checker = new HealthChecker(registry, { intervalMs: 100, probe });

    checker.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(probe).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(500);
    expect(probe).toHaveBeenCalledTimes(2);

    resolveProbes.splice(0).forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(100);
    expect(probe).toHaveBeenCalledTimes(4);

    checker.stop();
  });
});
