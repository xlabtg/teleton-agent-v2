# V2-02: Associative Graph Memory

## Overview

Build a graph-based associative memory that models relationships between entities, concepts, and interactions. This enables the agent to traverse connections and surface related context that flat storage cannot provide.

## Current State

V1 stores memories as independent records with no relational structure. There is no way to navigate from one memory to related concepts or entities.

## Problem

Without relational links, the agent cannot reason about how topics connect, discover transitive relationships, or build a coherent world model from accumulated interactions.

## What to Implement

- Entity and concept node extraction from conversations
- Typed edge creation between related nodes (e.g., "mentions", "caused_by", "related_to")
- Graph traversal queries for multi-hop relationship discovery
- Automatic graph maintenance (merging duplicates, pruning stale nodes)
- Visualization endpoint for debugging the knowledge graph

## Implementation Steps

1. Define a graph schema with node types (entity, concept, event) and edge types
2. Implement an entity extraction pipeline using NLP or LLM-based extraction
3. Build a graph storage adapter supporting in-memory and persistent backends
4. Create traversal utilities for breadth-first and weighted path queries
5. Add deduplication and merge logic for equivalent nodes
6. Expose a query API that returns subgraphs relevant to a given context

## Files to Create/Modify

- `packages/memory/src/graph-store.ts`
- `packages/memory/src/entity-extractor.ts`
- `packages/memory/src/graph-query.ts`
- `packages/memory/src/graph-maintenance.ts`

## Dependencies

- V2-01 (Semantic Vector Memory) for embedding-based node similarity
- Graph database or in-memory graph library

## Notes

- Start with an in-memory graph for development; add persistent backend later
- Edge weights should decay over time to reflect relevance freshness
- Keep extraction prompts modular so they can be tuned per domain
