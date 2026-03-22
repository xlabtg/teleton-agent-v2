import { describe, it, expect, beforeEach } from "vitest";
import { AgentRegistry } from "../../packages/agents/src/agent-registry.js";
import { DiscoveryService } from "../../packages/agents/src/discovery-service.js";

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
