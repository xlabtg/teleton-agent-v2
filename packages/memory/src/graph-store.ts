/**
 * Graph-based associative memory store.
 * Models relationships between entities, concepts, and interactions
 * as a directed graph with typed, weighted edges.
 */

export type NodeType = "entity" | "concept" | "event";

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  properties: Record<string, unknown>;
  createdAt: Date;
  accessedAt: Date;
}

export type EdgeType =
  | "mentions"
  | "caused_by"
  | "related_to"
  | "part_of"
  | "follows"
  | "similar_to";

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  weight: number;
  properties: Record<string, unknown>;
  createdAt: Date;
}

export interface GraphStore {
  addNode(node: Omit<GraphNode, "id" | "createdAt" | "accessedAt">): GraphNode;
  getNode(id: string): GraphNode | undefined;
  findNodesByLabel(label: string): GraphNode[];
  findNodesByType(type: NodeType): GraphNode[];
  updateNode(
    id: string,
    updates: Partial<Pick<GraphNode, "label" | "properties">>
  ): GraphNode | undefined;
  removeNode(id: string): boolean;

  addEdge(edge: Omit<GraphEdge, "id" | "createdAt">): GraphEdge;
  getEdgesFrom(nodeId: string, type?: EdgeType): GraphEdge[];
  getEdgesTo(nodeId: string, type?: EdgeType): GraphEdge[];
  removeEdge(id: string): boolean;
  updateEdgeWeight(id: string, weight: number): boolean;

  nodeCount(): number;
  edgeCount(): number;
  clear(): void;
}

/**
 * In-memory graph store implementation.
 * Suitable for development; can be replaced with a persistent backend.
 */
export class InMemoryGraphStore implements GraphStore {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private readonly outEdges = new Map<string, Set<string>>(); // nodeId -> edgeIds
  private readonly inEdges = new Map<string, Set<string>>(); // nodeId -> edgeIds

  addNode(input: Omit<GraphNode, "id" | "createdAt" | "accessedAt">): GraphNode {
    const node: GraphNode = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      accessedAt: new Date(),
    };
    this.nodes.set(node.id, node);
    this.outEdges.set(node.id, new Set());
    this.inEdges.set(node.id, new Set());
    return node;
  }

  getNode(id: string): GraphNode | undefined {
    const node = this.nodes.get(id);
    if (node) {
      node.accessedAt = new Date();
    }
    return node;
  }

  findNodesByLabel(label: string): GraphNode[] {
    const normalized = label.toLowerCase().trim();
    return Array.from(this.nodes.values()).filter(
      (n) => n.label.toLowerCase().trim() === normalized
    );
  }

  findNodesByType(type: NodeType): GraphNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.type === type);
  }

  updateNode(
    id: string,
    updates: Partial<Pick<GraphNode, "label" | "properties">>
  ): GraphNode | undefined {
    const node = this.nodes.get(id);
    if (!node) return undefined;

    if (updates.label !== undefined) node.label = updates.label;
    if (updates.properties !== undefined) {
      node.properties = { ...node.properties, ...updates.properties };
    }
    node.accessedAt = new Date();
    return node;
  }

  removeNode(id: string): boolean {
    if (!this.nodes.has(id)) return false;

    // Remove all connected edges
    const out = this.outEdges.get(id) ?? new Set();
    const inc = this.inEdges.get(id) ?? new Set();

    for (const edgeId of out) {
      const edge = this.edges.get(edgeId);
      if (edge) {
        this.inEdges.get(edge.targetId)?.delete(edgeId);
      }
      this.edges.delete(edgeId);
    }

    for (const edgeId of inc) {
      const edge = this.edges.get(edgeId);
      if (edge) {
        this.outEdges.get(edge.sourceId)?.delete(edgeId);
      }
      this.edges.delete(edgeId);
    }

    this.outEdges.delete(id);
    this.inEdges.delete(id);
    this.nodes.delete(id);
    return true;
  }

  addEdge(input: Omit<GraphEdge, "id" | "createdAt">): GraphEdge {
    if (!this.nodes.has(input.sourceId)) {
      throw new Error(`Source node '${input.sourceId}' not found`);
    }
    if (!this.nodes.has(input.targetId)) {
      throw new Error(`Target node '${input.targetId}' not found`);
    }

    const edge: GraphEdge = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };

    this.edges.set(edge.id, edge);
    this.outEdges.get(edge.sourceId)!.add(edge.id);
    this.inEdges.get(edge.targetId)!.add(edge.id);
    return edge;
  }

  getEdgesFrom(nodeId: string, type?: EdgeType): GraphEdge[] {
    const edgeIds = this.outEdges.get(nodeId) ?? new Set();
    const edges: GraphEdge[] = [];

    for (const id of edgeIds) {
      const edge = this.edges.get(id);
      if (edge && (type === undefined || edge.type === type)) {
        edges.push(edge);
      }
    }

    return edges;
  }

  getEdgesTo(nodeId: string, type?: EdgeType): GraphEdge[] {
    const edgeIds = this.inEdges.get(nodeId) ?? new Set();
    const edges: GraphEdge[] = [];

    for (const id of edgeIds) {
      const edge = this.edges.get(id);
      if (edge && (type === undefined || edge.type === type)) {
        edges.push(edge);
      }
    }

    return edges;
  }

  removeEdge(id: string): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;

    this.outEdges.get(edge.sourceId)?.delete(id);
    this.inEdges.get(edge.targetId)?.delete(id);
    this.edges.delete(id);
    return true;
  }

  updateEdgeWeight(id: string, weight: number): boolean {
    const edge = this.edges.get(id);
    if (!edge) return false;
    edge.weight = weight;
    return true;
  }

  nodeCount(): number {
    return this.nodes.size;
  }

  edgeCount(): number {
    return this.edges.size;
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.outEdges.clear();
    this.inEdges.clear();
  }
}
