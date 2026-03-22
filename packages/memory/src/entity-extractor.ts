/**
 * Entity extraction pipeline.
 * Extracts entities and concepts from text for graph construction.
 * Supports LLM-based extraction and simple pattern-based fallback.
 */

import type { LLMProvider } from "@teleton/core/ports/service.port.js";
import type { NodeType } from "./graph-store.js";

export interface ExtractedEntity {
  label: string;
  type: NodeType;
  properties: Record<string, unknown>;
}

export interface ExtractedRelation {
  sourceLabel: string;
  targetLabel: string;
  type: string;
  weight: number;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

export interface EntityExtractor {
  extract(text: string): Promise<ExtractionResult>;
}

/**
 * Pattern-based entity extractor.
 * Uses simple heuristics to identify entities and relationships.
 * No external dependencies required — suitable as a fallback.
 */
export class PatternEntityExtractor implements EntityExtractor {
  async extract(text: string): Promise<ExtractionResult> {
    const entities: ExtractedEntity[] = [];
    const relations: ExtractedRelation[] = [];
    const seen = new Set<string>();

    // Extract capitalized phrases as entities (simple NER heuristic)
    const capitalizedPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
    let match;

    while ((match = capitalizedPattern.exec(text)) !== null) {
      const label = match[1];
      if (!seen.has(label.toLowerCase()) && label.length > 1) {
        seen.add(label.toLowerCase());
        entities.push({
          label,
          type: "entity",
          properties: { source: "pattern" },
        });
      }
    }

    // Extract quoted terms as concepts
    const quotedPattern = /"([^"]+)"|'([^']+)'/g;
    while ((match = quotedPattern.exec(text)) !== null) {
      const label = match[1] ?? match[2];
      if (!seen.has(label.toLowerCase())) {
        seen.add(label.toLowerCase());
        entities.push({
          label,
          type: "concept",
          properties: { source: "pattern" },
        });
      }
    }

    // Create "related_to" relations between co-occurring entities
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        relations.push({
          sourceLabel: entities[i].label,
          targetLabel: entities[j].label,
          type: "related_to",
          weight: 0.5,
        });
      }
    }

    return { entities, relations };
  }
}

/**
 * LLM-based entity extractor.
 * Uses a language model to identify entities, concepts, and relationships.
 */
export class LLMEntityExtractor implements EntityExtractor {
  constructor(private readonly llm: LLMProvider) {}

  async extract(text: string): Promise<ExtractionResult> {
    const systemPrompt = `You are an entity and relationship extractor. Given text, extract:
1. Entities (people, organizations, systems, tools) with type "entity"
2. Concepts (ideas, topics, categories) with type "concept"
3. Events (actions, occurrences) with type "event"
4. Relationships between them

Respond ONLY with valid JSON in this format:
{
  "entities": [{"label": "name", "type": "entity|concept|event", "properties": {}}],
  "relations": [{"sourceLabel": "source", "targetLabel": "target", "type": "mentions|caused_by|related_to|part_of|follows|similar_to", "weight": 0.0-1.0}]
}`;

    const response = await this.llm.chat(
      [
        { role: "system", content: systemPrompt, timestamp: new Date() },
        { role: "user", content: text, timestamp: new Date() },
      ],
      { temperature: 0 }
    );

    try {
      const parsed = JSON.parse(response.content) as ExtractionResult;
      return {
        entities: parsed.entities ?? [],
        relations: parsed.relations ?? [],
      };
    } catch {
      // Fall back to empty result if LLM response is malformed
      return { entities: [], relations: [] };
    }
  }
}
