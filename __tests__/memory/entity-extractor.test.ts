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
