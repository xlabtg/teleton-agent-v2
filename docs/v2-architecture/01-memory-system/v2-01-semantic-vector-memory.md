# V2-01: Semantic Vector Memory

## Overview
Implement a semantic vector memory system using embeddings to enable meaning-based recall rather than keyword matching. This allows the agent to retrieve contextually relevant memories even when exact terms differ.

## Current State
V1 uses simple key-value storage for conversation history with no semantic understanding. Memory retrieval relies on exact or substring matches.

## Problem
Keyword-based retrieval misses semantically related content, leading to incomplete context in conversations. The agent cannot draw connections between conceptually similar but lexically different interactions.

## What to Implement
- Embedding generation pipeline for all stored memories
- Vector similarity search using cosine distance
- Configurable relevance thresholds for retrieval
- Batch indexing for existing memory migration
- Hybrid search combining vector and keyword approaches

## Implementation Steps
1. Integrate an embedding model (e.g., OpenAI text-embedding-3-small or local alternative)
2. Create a vector store abstraction layer supporting multiple backends (in-memory, pgvector, Pinecone)
3. Build an indexing pipeline that embeds memories on write
4. Implement similarity search with configurable top-k and threshold parameters
5. Add a hybrid retrieval strategy that merges vector and keyword results
6. Write migration tooling to backfill embeddings for existing memories

## Files to Create/Modify
- `packages/memory/src/vector-store.ts`
- `packages/memory/src/embedding-provider.ts`
- `packages/memory/src/semantic-search.ts`
- `packages/memory/src/hybrid-retrieval.ts`

## Dependencies
- Embedding model API access or local model runtime
- Vector database or in-memory HNSW index library
- V2-02 (Associative Graph Memory) for cross-referencing

## Notes
- Keep the vector store interface abstract so backends can be swapped without code changes
- Consider dimensionality and storage costs when choosing an embedding model
- Latency budget for retrieval should stay under 100ms for interactive use
