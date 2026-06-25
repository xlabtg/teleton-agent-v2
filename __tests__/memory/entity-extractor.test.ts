import { describe, it, expect } from "vitest";
import { PatternEntityExtractor } from "../../packages/memory/src/entity-extractor.js";

describe("PatternEntityExtractor", () => {
  const extractor = new PatternEntityExtractor();

  it("should extract capitalized names as entities", async () => {
    const result = await extractor.extract("Alice and Bob discussed the project.");

    const labels = result.entities.map((e) => e.label);
    expect(labels).toContain("Alice");
    expect(labels).toContain("Bob");
  });

  it("should extract acronyms as entities", async () => {
    const result = await extractor.extract("Alice reviewed the API and SQL migration.");

    const labels = result.entities.map((e) => e.label);
    expect(labels).toContain("API");
    expect(labels).toContain("SQL");
  });

  it("should extract Unicode names as entities", async () => {
    const result = await extractor.extract("Мария discussed Montréal with François.");

    const labels = result.entities.map((e) => e.label);
    expect(labels).toContain("Мария");
    expect(labels).toContain("Montréal");
    expect(labels).toContain("François");
  });

  it("should extract quoted terms as concepts", async () => {
    const result = await extractor.extract('The concept of "machine learning" is important.');

    const concepts = result.entities.filter((e) => e.type === "concept");
    expect(concepts.some((c) => c.label === "machine learning")).toBe(true);
  });

  it("should create relations between co-occurring entities", async () => {
    const result = await extractor.extract("Alice met Bob at the conference.");

    expect(result.relations.length).toBeGreaterThan(0);
    expect(result.relations[0].type).toBe("related_to");
  });

  it("should only relate entities that share a sentence", async () => {
    const result = await extractor.extract("Alice met Bob. Carol met Dave.");

    expect(result.relations).toContainEqual({
      sourceLabel: "Alice",
      targetLabel: "Bob",
      type: "related_to",
      weight: 0.5,
    });
    expect(result.relations).toContainEqual({
      sourceLabel: "Carol",
      targetLabel: "Dave",
      type: "related_to",
      weight: 0.5,
    });
    expect(result.relations).not.toContainEqual({
      sourceLabel: "Alice",
      targetLabel: "Carol",
      type: "related_to",
      weight: 0.5,
    });
  });

  it("should cap relations for entity-dense inputs", async () => {
    const labels = [
      "API",
      "SQL",
      "HTTP",
      "JSON",
      "XML",
      "CSS",
      "HTML",
      "DNS",
      "TLS",
      "JWT",
      "SSH",
      "CPU",
      "GPU",
      "RAM",
      "CLI",
      "SDK",
      "URL",
      "URI",
      "RPC",
      "TCP",
    ].join(" ");
    const result = await extractor.extract(labels);

    expect(result.entities).toHaveLength(20);
    expect(result.relations).toHaveLength(50);
  });

  it("should deduplicate entities by label", async () => {
    const result = await extractor.extract("Alice likes Alice but not alice.");

    const aliceEntities = result.entities.filter((e) => e.label.toLowerCase() === "alice");
    expect(aliceEntities).toHaveLength(1);
  });

  it("should handle empty text", async () => {
    const result = await extractor.extract("");
    expect(result.entities).toHaveLength(0);
    expect(result.relations).toHaveLength(0);
  });
});
