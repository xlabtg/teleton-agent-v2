import { describe, it, expect, beforeEach } from "vitest";
import { AgentRegistry } from "../../packages/agents/src/agent-registry.js";
import { DiscoveryService } from "../../packages/agents/src/discovery-service.js";
import { DelegationRouter } from "../../packages/agents/src/delegation-router.js";

function makeRegistry() {
  const registry = new AgentRegistry();

  registry.register({
    id: "agent-code",
    name: "Code Agent",
    version: "1.0.0",
    namespace: "default",
    capabilities: [
      {
        name: "code-review",
        description: "Reviews code",
        version: "1.0.0",
        tags: ["code", "quality"],
        confidence: 0.9,
      },
      {
        name: "linting",
        description: "Lints code",
        version: "1.0.0",
        tags: ["code"],
        confidence: 0.8,
      },
    ],
  });
  registry.updateStatus("agent-code", "healthy");

  registry.register({
    id: "agent-ton",
    name: "TON Agent",
    version: "1.0.0",
    namespace: "default",
    capabilities: [
      {
        name: "ton-transfer",
        description: "Transfers TON",
        version: "1.0.0",
        tags: ["blockchain", "ton"],
        confidence: 0.95,
      },
    ],
  });
  registry.updateStatus("agent-ton", "healthy");

  registry.register({
    id: "agent-sick",
    name: "Sick Agent",
    version: "1.0.0",
    namespace: "default",
    capabilities: [
      {
        name: "code-review",
        description: "Reviews code",
        version: "0.1.0",
        tags: ["code"],
        confidence: 0.4,
      },
    ],
  });
  registry.updateStatus("agent-sick", "unhealthy");

  return registry;
}

describe("DiscoveryService", () => {
  let service: DiscoveryService;

  beforeEach(() => {
    service = new DiscoveryService(makeRegistry());
  });

  it("should find agents by required capability", () => {
    const results = service.find({ required: ["code-review"] });
    // Unhealthy agent excluded by default
    expect(results.length).toBe(1);
    expect(results[0].descriptor.id).toBe("agent-code");
  });

  it("should include unhealthy agents when excludeUnhealthy=false", () => {
    const results = service.find({ required: ["code-review"], excludeUnhealthy: false });
    expect(results.length).toBe(2);
  });

  it("should return empty when no agent satisfies required capabilities", () => {
    const results = service.find({ required: ["unicorn-capability"] });
    expect(results.length).toBe(0);
  });

  it("should rank by score descending", () => {
    const results = service.find({ required: ["code-review"], excludeUnhealthy: false });
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  it("findBest should return single best result", () => {
    const best = service.findBest({ required: ["code-review"] });
    expect(best).toBeDefined();
    expect(best!.descriptor.id).toBe("agent-code");
  });

  it("findBest should prefer healthy agents over degraded agents with higher confidence", () => {
    const registry = new AgentRegistry();
    registry.register({
      id: "healthy-low-confidence",
      name: "Healthy Low Confidence",
      version: "1.0.0",
      capabilities: [
        {
          name: "analyze",
          description: "Analyzes tasks",
          version: "1.0.0",
          tags: [],
          confidence: 0.2,
        },
      ],
    });
    registry.updateStatus("healthy-low-confidence", "healthy");

    registry.register({
      id: "degraded-high-confidence",
      name: "Degraded High Confidence",
      version: "1.0.0",
      capabilities: [
        {
          name: "analyze",
          description: "Analyzes tasks",
          version: "1.0.0",
          tags: [],
          confidence: 1,
        },
      ],
    });
    registry.updateStatus("degraded-high-confidence", "degraded");

    const best = new DiscoveryService(registry).findBest({ required: ["analyze"] });

    expect(best?.descriptor.id).toBe("healthy-low-confidence");
  });

  it("should choose the same top agent as best-fit routing for an equivalent query", () => {
    const registry = new AgentRegistry();
    registry.register({
      id: "healthy-capable",
      name: "Healthy Capable",
      version: "1.0.0",
      capabilities: [
        {
          name: "summarize",
          description: "Summarizes content",
          version: "1.0.0",
          tags: ["text"],
          confidence: 0.4,
        },
      ],
    });
    registry.updateStatus("healthy-capable", "healthy");

    registry.register({
      id: "degraded-capable",
      name: "Degraded Capable",
      version: "1.0.0",
      capabilities: [
        {
          name: "summarize",
          description: "Summarizes content",
          version: "1.0.0",
          tags: ["text"],
          confidence: 1,
        },
      ],
    });
    registry.updateStatus("degraded-capable", "degraded");

    const discoveryBest = new DiscoveryService(registry).findBest({ required: ["summarize"] });
    const routingDecision = new DelegationRouter(registry, { strategy: "best-fit" }).routeOne({
      id: "subtask-1",
      name: "summarize",
      description: "",
      requiredCapability: "summarize",
      dependsOn: [],
      payload: {},
      priorityWeight: 50,
    });

    expect(discoveryBest?.descriptor.id).toBe(routingDecision.assignedAgentId);
  });

  it("findByCapability convenience method works", () => {
    const results = service.findByCapability("ton-transfer");
    expect(results.length).toBe(1);
    expect(results[0].descriptor.id).toBe("agent-ton");
  });

  it("should respect limit parameter", () => {
    const results = service.find({ required: ["code-review"], excludeUnhealthy: false, limit: 1 });
    expect(results.length).toBe(1);
  });
});
