import { describe, it, expect, beforeEach } from "vitest";
import { PromptRegistry } from "../../packages/learning/src/prompt-registry.js";
import { PromptComposer } from "../../packages/learning/src/prompt-composer.js";

describe("PromptComposer", () => {
  let registry: PromptRegistry;
  let composer: PromptComposer;

  beforeEach(() => {
    registry = new PromptRegistry();
    composer = new PromptComposer(registry);

    registry.register("system-role", "You are a helpful assistant.", "System role");
    registry.promote("system-role", 1);

    registry.register("task-summarise", "Summarise the following text: {{text}}", "Summarise task");
    registry.promote("task-summarise", 1);
  });

  it("should compose a prompt from multiple sections", () => {
    const result = composer.compose(
      {
        sections: [{ templateKey: "system-role" }, { templateKey: "task-summarise" }],
      },
      { text: "Lorem ipsum" }
    );

    expect(result.text).toContain("You are a helpful assistant.");
    expect(result.text).toContain("Summarise the following text: Lorem ipsum");
    expect(result.resolvedKeys).toEqual(["system-role", "task-summarise"]);
    expect(result.fallbackKeys).toHaveLength(0);
  });

  it("should use fallback text for missing templates", () => {
    const result = composer.compose({
      sections: [{ templateKey: "missing-key", fallback: "Default instruction." }],
    });

    expect(result.text).toBe("Default instruction.");
    expect(result.fallbackKeys).toContain("missing-key");
    expect(result.resolvedKeys).toHaveLength(0);
  });

  it("should skip sections with no template and no fallback", () => {
    const result = composer.compose({
      sections: [{ templateKey: "system-role" }, { templateKey: "totally-missing" }],
    });

    expect(result.text).not.toContain("totally-missing");
    expect(result.resolvedKeys).toEqual(["system-role"]);
  });

  it("should interpolate variables into fallback text", () => {
    const result = composer.compose(
      {
        sections: [{ templateKey: "absent", fallback: "Hello, {{name}}!" }],
      },
      { name: "World" }
    );

    expect(result.text).toBe("Hello, World!");
  });

  it("should use a custom separator", () => {
    const result = composer.compose(
      {
        sections: [{ templateKey: "system-role" }, { templateKey: "task-summarise" }],
        separator: "\n---\n",
      },
      { text: "abc" }
    );

    expect(result.text).toContain("\n---\n");
  });

  it("should compose a single section via composeSingle", () => {
    const result = composer.composeSingle("system-role");
    expect(result.text).toBe("You are a helpful assistant.");
  });

  it("should render a raw template without registry lookup", () => {
    const rendered = composer.render("Hi {{user}}, today is {{day}}.", {
      user: "Alice",
      day: "Monday",
    });
    expect(rendered).toBe("Hi Alice, today is Monday.");
  });

  it("should leave unknown placeholders unchanged", () => {
    const rendered = composer.render("Hello {{unknown}}!", {});
    expect(rendered).toBe("Hello {{unknown}}!");
  });
});
