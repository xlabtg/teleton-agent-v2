/**
 * Health Checker — V2-07.
 * Polls registered agents at a configurable interval and updates their
 * status in the AgentRegistry. Agents that fail consecutive checks are
 * marked "unhealthy" and optionally deregistered.
 *
 * The health check is intentionally simple: the checker calls a user-supplied
 * `probe` function so that different transport types (HTTP, in-process, IPC)
 * can be supported without hard-coding any one approach.
 */

import type { AgentRegistry } from "./agent-registry.js";
import type { AgentStatus } from "./agent-descriptor.js";
import { NotFoundError } from "../../core/src/errors/domain-errors.js";

/** Function that probes a single agent and resolves to true if healthy. */
export type HealthProbe = (agentId: string, endpoint?: string) => Promise<boolean>;

export interface HealthCheckerConfig {
  /**
   * How often to run health checks, in milliseconds. Default: 30_000 (30 s).
   */
  intervalMs?: number;
  /**
   * Number of consecutive failures before marking an agent "unhealthy".
   * Default: 3.
   */
  failureThreshold?: number;
  /**
   * Number of consecutive successful probes required before recovering to
   * "healthy" after a degraded or unhealthy status. Default: 2.
   */
  recoveryThreshold?: number;
  /**
   * If true, automatically deregister agents once they become "unhealthy".
   * Default: false.
   */
  autoDeregister?: boolean;
  /**
   * User-supplied probe function. Falls back to a no-op that always succeeds
   * when not provided (useful for testing the scheduler logic).
   */
  probe?: HealthProbe;
}

interface AgentHealthState {
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckedAt: Date;
  lastStatus: AgentStatus;
}

export class HealthChecker {
  private readonly registry: AgentRegistry;
  private readonly intervalMs: number;
  private readonly failureThreshold: number;
  private readonly recoveryThreshold: number;
  private readonly autoDeregister: boolean;
  private readonly probe: HealthProbe;
  private readonly state = new Map<string, AgentHealthState>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(registry: AgentRegistry, config: HealthCheckerConfig = {}) {
    this.registry = registry;
    this.intervalMs = config.intervalMs ?? 30_000;
    this.failureThreshold = config.failureThreshold ?? 3;
    this.recoveryThreshold = config.recoveryThreshold ?? 2;
    this.autoDeregister = config.autoDeregister ?? false;
    this.probe = config.probe ?? (() => Promise.resolve(true));
  }

  /** Start the polling loop. Idempotent — calling twice is safe. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNextCheck();
  }

  /** Stop the polling loop. */
  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** True if the polling loop is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Run a single health-check round for all registered agents.
   * Useful for testing or on-demand checks without starting the scheduler.
   */
  async runChecks(): Promise<void> {
    const agents = this.registry.list("*");

    await Promise.all(
      agents.map(async (agent) => {
        const isHealthy = await this.probe(agent.id, agent.healthEndpoint).catch(() => false);
        this.applyResult(agent.id, isHealthy, agent);
      })
    );
  }

  /** Check a single agent by id and update its status. */
  async checkAgent(agentId: string): Promise<AgentStatus> {
    const agent = this.registry.get(agentId);
    const isHealthy = await this.probe(agentId, agent.healthEndpoint).catch(() => false);
    return this.applyResult(agentId, isHealthy);
  }

  /** Return the current health state tracked for an agent. */
  getState(agentId: string): AgentHealthState | undefined {
    return this.state.get(agentId);
  }

  private scheduleNextCheck(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;

      void this.runChecks().finally(() => {
        if (this.running) {
          this.scheduleNextCheck();
        }
      });
    }, this.intervalMs);
  }

  private applyResult(
    agentId: string,
    isHealthy: boolean,
    expectedAgent?: ReturnType<AgentRegistry["get"]>
  ): AgentStatus {
    let liveAgent: ReturnType<AgentRegistry["get"]>;

    try {
      liveAgent = this.registry.get(agentId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        this.state.delete(agentId);
        return "unknown";
      }
      throw error;
    }

    if (expectedAgent && liveAgent !== expectedAgent) {
      return liveAgent.status;
    }

    const prev = this.state.get(agentId) ?? {
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastCheckedAt: new Date(),
      lastStatus: "unknown" as AgentStatus,
    };

    let status: AgentStatus;

    if (isHealthy) {
      const successes = prev.consecutiveSuccesses + 1;
      const isRecovering = prev.lastStatus === "degraded" || prev.lastStatus === "unhealthy";
      status = !isRecovering || successes >= this.recoveryThreshold ? "healthy" : "degraded";
      this.state.set(agentId, {
        consecutiveFailures: 0,
        consecutiveSuccesses: successes,
        lastCheckedAt: new Date(),
        lastStatus: status,
      });
    } else {
      const failures = prev.consecutiveFailures + 1;
      status = failures >= this.failureThreshold ? "unhealthy" : "degraded";
      this.state.set(agentId, {
        consecutiveFailures: failures,
        consecutiveSuccesses: 0,
        lastCheckedAt: new Date(),
        lastStatus: status,
      });
    }

    this.registry.updateStatus(agentId, status);

    if (status === "unhealthy" && this.autoDeregister) {
      try {
        this.registry.deregister(agentId);
        this.state.delete(agentId);
      } catch (error) {
        if (!(error instanceof NotFoundError)) {
          throw error;
        }
      }
    }

    return status;
  }
}
