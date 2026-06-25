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

const ENTITY_RELATION_LIMIT = 50;

const STOPWORDS = new Set([
  "and",
  "but",
  "or",
  "the",
  "a",
  "an",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "to",
  "with",
  "и",
  "а",
  "но",
  "или",
  "в",
  "во",
  "на",
  "по",
  "с",
  "со",
  "у",
  "о",
  "об",
]);

const SENTENCE_PATTERN = /[^.!?\n]+/gu;
const ENTITY_TOKEN_PATTERN = /(?:\p{Lu}[\p{L}\p{M}\p{N}_-]*|\p{L}[\p{Lu}\p{M}\p{N}_-]+)/gu;

function normalizeLabel(label: string): string {
  return label.toLocaleLowerCase();
}

function isStopword(label: string): boolean {
  return STOPWORDS.has(normalizeLabel(label));
}

function addEntity(
  entities: ExtractedEntity[],
  seen: Set<string>,
  label: string,
  type: NodeType
): void {
  const trimmed = label.trim();
  const normalized = normalizeLabel(trimmed);
  if (trimmed.length <= 1 || seen.has(normalized) || isStopword(trimmed)) {
    return;
  }

  seen.add(normalized);
  entities.push({
    label: trimmed,
    type,
    properties: { source: "pattern" },
  });
}

function extractEntityLabels(text: string): string[] {
  return Array.from(text.matchAll(ENTITY_TOKEN_PATTERN), (match) => match[0]);
}

function extractSentenceEntities(sentence: string, knownLabels: Set<string>): string[] {
  const labels: string[] = [];
  const seenInSentence = new Set<string>();

  for (const label of extractEntityLabels(sentence)) {
    const normalized = normalizeLabel(label);
    if (knownLabels.has(normalized) && !seenInSentence.has(normalized)) {
      seenInSentence.add(normalized);
      labels.push(label);
    }
  }

  return labels;
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

    // Extract capitalized/acronym/Unicode phrases as entities (simple NER heuristic)
    let match;
    for (const label of extractEntityLabels(text)) {
      addEntity(entities, seen, label, "entity");
    }

    // Extract quoted terms as concepts
    const quotedPattern = /"([^"]+)"|'([^']+)'/g;
    while ((match = quotedPattern.exec(text)) !== null) {
      const label = match[1] ?? match[2];
      addEntity(entities, seen, label, "concept");
    }

    // Create bounded "related_to" relations for entities sharing a sentence.
    const knownLabels = new Set(entities.map((entity) => normalizeLabel(entity.label)));
    SENTENCE_PATTERN.lastIndex = 0;
    while (
      relations.length < ENTITY_RELATION_LIMIT &&
      (match = SENTENCE_PATTERN.exec(text)) !== null
    ) {
      const sentenceEntities = extractSentenceEntities(match[0], knownLabels);
      for (let i = 0; i < sentenceEntities.length; i++) {
        for (let j = i + 1; j < sentenceEntities.length; j++) {
          if (relations.length >= ENTITY_RELATION_LIMIT) {
            break;
          }

          relations.push({
            sourceLabel: sentenceEntities[i],
            targetLabel: sentenceEntities[j],
            type: "related_to",
            weight: 0.5,
          });
        }
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
