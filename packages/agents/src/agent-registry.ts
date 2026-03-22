/**
 * Agent Registry — V2-07.
 * In-memory CRUD store for agent descriptors.
 * Supports both push (agent self-registers) and pull (admin registers) models.
 * Namespace isolation ensures descriptors from one tenant are invisible to another
 * unless queried with the wildcard namespace "*".
 */

import { NotFoundError, ValidationError } from "../../core/src/errors/domain-errors.js";
import type {
  AgentDescriptor,
  AgentCapabilityDescriptor,
  RegisterAgentInput,
  AgentStatus,
} from "./agent-descriptor.js";

export interface AgentRegistryConfig {
  /**
   * Maximum number of agents allowed in the registry.
   * Set to 0 for unlimited. Default: 0.
   */
  maxAgents?: number;
}

export class AgentRegistry {
  private readonly agents = new Map<string, AgentDescriptor>();
  private readonly maxAgents: number;

  constructor(config: AgentRegistryConfig = {}) {
    this.maxAgents = config.maxAgents ?? 0;
  }

  /** Register a new agent or replace an existing one with the same id. */
  register(input: RegisterAgentInput): AgentDescriptor {
    if (!input.id || !input.name || !input.version) {
      throw new ValidationError("Agent id, name, and version are required");
    }

    if (this.maxAgents > 0 && !this.agents.has(input.id) && this.agents.size >= this.maxAgents) {
      throw new ValidationError(
        `Registry is at capacity (${this.maxAgents} agents). Deregister an agent first.`
      );
    }

    const now = new Date();
    const existing = this.agents.get(input.id);

    const descriptor: AgentDescriptor = {
      id: input.id,
      name: input.name,
      version: input.version,
      namespace: input.namespace ?? "default",
      capabilities: input.capabilities,
      healthEndpoint: input.healthEndpoint,
      registeredAt: existing?.registeredAt ?? now,
      updatedAt: now,
      status: "unknown",
      metadata: input.metadata ?? {},
    };

    this.agents.set(input.id, descriptor);
    return descriptor;
  }

  /** Remove an agent from the registry. Throws if not found. */
  deregister(id: string): void {
    if (!this.agents.has(id)) {
      throw new NotFoundError("Agent", id);
    }
    this.agents.delete(id);
  }

  /** Get a single agent descriptor by id. Throws if not found. */
  get(id: string): AgentDescriptor {
    const descriptor = this.agents.get(id);
    if (!descriptor) {
      throw new NotFoundError("Agent", id);
    }
    return descriptor;
  }

  /**
   * Return all agents filtered by namespace.
   * Pass "*" to list across all namespaces.
   * Defaults to the "default" namespace when no argument is provided.
   */
  list(namespace = "default"): AgentDescriptor[] {
    const all = Array.from(this.agents.values());
    if (namespace === "*") return all;
    return all.filter((a) => a.namespace === namespace);
  }

  /** Update the health status of a registered agent. */
  updateStatus(id: string, status: AgentStatus): void {
    const descriptor = this.agents.get(id);
    if (!descriptor) {
      throw new NotFoundError("Agent", id);
    }
    descriptor.status = status;
    descriptor.updatedAt = new Date();
  }

  /** Update individual capability metadata without re-registering. */
  updateCapabilities(id: string, capabilities: AgentCapabilityDescriptor[]): void {
    const descriptor = this.agents.get(id);
    if (!descriptor) {
      throw new NotFoundError("Agent", id);
    }
    descriptor.capabilities = capabilities;
    descriptor.updatedAt = new Date();
  }

  /** Number of registered agents. */
  get size(): number {
    return this.agents.size;
  }
}
