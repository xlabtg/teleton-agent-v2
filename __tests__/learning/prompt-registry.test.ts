import { describe, it, expect, beforeEach } from "vitest";
import { PromptRegistry } from "../../packages/learning/src/prompt-registry.js";

describe("PromptRegistry", () => {
  let registry: PromptRegistry;

  beforeEach(() => {
    registry = new PromptRegistry();
  });

  it("should register a template with version 1", () => {
    const pt = registry.register("greet", "Hello, {{name}}!", "Greeting template");
    expect(pt.key).toBe("greet");
    expect(pt.versions).toHaveLength(1);
    expect(pt.versions[0].version).toBe(1);
    expect(pt.activeVersion).toBeNull();
  });

  it("should throw when registering a duplicate key", () => {
    registry.register("greet", "Hello!", "desc");
    expect(() => registry.register("greet", "Hi!", "desc")).toThrow();
  });

  it("should add new versions and increment version numbers", () => {
    registry.register("greet", "Hello!", "desc");
    const v2 = registry.addVersion("greet", "Hi there!", "more casual");
    expect(v2.version).toBe(2);
  });

  it("should promote a version and mark it active", () => {
    registry.register("greet", "Hello!", "desc");
    registry.addVersion("greet", "Hi!", "v2");
    registry.promote("greet", 2);

    const pt = registry.get("greet")!;
    expect(pt.activeVersion).toBe(2);
    expect(pt.versions.find((v) => v.version === 2)!.active).toBe(true);
    expect(pt.versions.find((v) => v.version === 1)!.active).toBe(false);
  });

  it("should return active template text", () => {
    registry.register("greet", "Hello!", "desc");
    expect(registry.getActiveTemplate("greet")).toBeNull();

    registry.promote("greet", 1);
    expect(registry.getActiveTemplate("greet")).toBe("Hello!");
  });

  it("should rollback to previous version", () => {
    registry.register("greet", "Hello!", "desc");
    registry.addVersion("greet", "Hi!", "v2");
    registry.promote("greet", 1);
    registry.promote("greet", 2);

    registry.rollback("greet");
    expect(registry.get("greet")!.activeVersion).toBe(1);
  });

  it("should return null when rolling back with only one version active", () => {
    registry.register("greet", "Hello!", "desc");
    registry.promote("greet", 1);

    const result = registry.rollback("greet");
    expect(result).toBeNull();
  });

  it("should delete a template", () => {
    registry.register("greet", "Hello!", "desc");
    expect(registry.delete("greet")).toBe(true);
    expect(registry.get("greet")).toBeUndefined();
  });

  it("should list all templates", () => {
    registry.register("greet", "Hello!", "desc1");
    registry.register("farewell", "Goodbye!", "desc2");
    expect(registry.list()).toHaveLength(2);
  });

  it("should prune oldest non-active versions when maxVersionsPerTemplate exceeded", () => {
    const smallRegistry = new PromptRegistry({ maxVersionsPerTemplate: 3 });
    smallRegistry.register("k", "v1", "desc");
    smallRegistry.addVersion("k", "v2", "c2");
    smallRegistry.addVersion("k", "v3", "c3");
    smallRegistry.addVersion("k", "v4", "c4"); // triggers pruning

    expect(smallRegistry.get("k")!.versions).toHaveLength(3);
  });
});
