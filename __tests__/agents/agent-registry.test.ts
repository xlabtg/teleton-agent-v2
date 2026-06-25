import { describe, it, expect, beforeEach } from "vitest";
import { AgentRegistry } from "../../packages/agents/src/agent-registry.js";
import { NotFoundError, ValidationError } from "../../packages/core/src/errors/domain-errors.js";

describe("AgentRegistry", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  it("should register a new agent and retrieve it", () => {
    const descriptor = registry.register({
      id: "agent-1",
      name: "Test Agent",
      version: "1.0.0",
      capabilities: [
        { name: "code-review", description: "Reviews code", version: "1.0.0", tags: ["code"] },
      ],
    });

    expect(descriptor.id).toBe("agent-1");
    expect(descriptor.status).toBe("unknown");
    expect(descriptor.namespace).toBe("default");
    expect(descriptor.registeredAt).toBeInstanceOf(Date);
    expect(descriptor.updatedAt).toBeInstanceOf(Date);
  });

  it("should update an existing agent on re-registration", () => {
    registry.register({ id: "a1", name: "Old", version: "1.0.0", capabilities: [] });
    const updated = registry.register({
      id: "a1",
      name: "New",
      version: "2.0.0",
      capabilities: [],
    });

    expect(updated.name).toBe("New");
    expect(updated.version).toBe("2.0.0");
    expect(registry.size).toBe(1);
  });

  it("should throw ValidationError for missing required fields", () => {
    expect(() =>
      registry.register({ id: "", name: "X", version: "1.0.0", capabilities: [] })
    ).toThrow(ValidationError);
    expect(() =>
      registry.register({ id: "a", name: "", version: "1.0.0", capabilities: [] })
    ).toThrow(ValidationError);
    expect(() => registry.register({ id: "a", name: "X", version: "", capabilities: [] })).toThrow(
      ValidationError
    );
  });

  it("should deregister an agent", () => {
    registry.register({ id: "a1", name: "A", version: "1.0.0", capabilities: [] });
    registry.deregister("a1");
    expect(registry.size).toBe(0);
  });

  it("should throw NotFoundError when deregistering unknown agent", () => {
    expect(() => registry.deregister("ghost")).toThrow(NotFoundError);
  });

  it("should throw NotFoundError when getting unknown agent", () => {
    expect(() => registry.get("ghost")).toThrow(NotFoundError);
  });

  it("should list agents filtered by namespace", () => {
    registry.register({
      id: "a1",
      name: "A",
      version: "1.0.0",
      namespace: "ns1",
      capabilities: [],
    });
    registry.register({
      id: "a2",
      name: "B",
      version: "1.0.0",
      namespace: "ns2",
      capabilities: [],
    });

    expect(registry.list("ns1").length).toBe(1);
    expect(registry.list("ns2").length).toBe(1);
    expect(registry.list("*").length).toBe(2);
    expect(registry.list().length).toBe(0); // "default" namespace
  });

  it("should update agent status", () => {
    registry.register({ id: "a1", name: "A", version: "1.0.0", capabilities: [] });
    registry.updateStatus("a1", "healthy");
    expect(registry.get("a1").status).toBe("healthy");
  });

  it("should enforce maxAgents limit", () => {
    const limited = new AgentRegistry({ maxAgents: 2 });
    limited.register({ id: "a1", name: "A", version: "1.0.0", capabilities: [] });
    limited.register({ id: "a2", name: "B", version: "1.0.0", capabilities: [] });
    expect(() =>
      limited.register({ id: "a3", name: "C", version: "1.0.0", capabilities: [] })
    ).toThrow(ValidationError);
    // Re-registering existing id should still be fine.
    expect(() =>
      limited.register({ id: "a1", name: "A-v2", version: "2.0.0", capabilities: [] })
    ).not.toThrow();
  });
});
