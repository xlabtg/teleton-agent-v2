/**
 * Agent Orchestrator - Manages multiple agents and delegates tasks.
 * Implements the multi-agent coordination pattern from v2-07/08/09.
 */

import type { IAgent, Task, TaskResult, TaskPriority } from "../domain/agent.interface.js";
import type { TaskRepository } from "../ports/repository.port.js";
import type { EventBus } from "../domain/events.js";
import { AgentRuntime } from "./agent-runtime.js";

export class AgentOrchestrator {
  private readonly agents = new Map<string, IAgent>();

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly taskRepository: TaskRepository,
    private readonly eventBus: EventBus
  ) {}

  registerAgent(agent: IAgent): void {
    this.agents.set(agent.id, agent);
  }

  unregisterAgent(id: string): void {
    this.agents.delete(id);
  }

  getAgent(id: string): IAgent | undefined {
    return this.agents.get(id);
  }

  listAgents(): IAgent[] {
    return Array.from(this.agents.values());
  }

  async delegate(
    taskName: string,
    payload: Record<string, unknown>,
    priority: TaskPriority = { level: "normal", weight: 50 }
  ): Promise<TaskResult> {
    // 1. Create task
    const task = await this.taskRepository.create({
      name: taskName,
      payload,
      priority,
    });

    await this.eventBus.publish({
      id: crypto.randomUUID(),
      type: "task.created",
      timestamp: new Date(),
      payload: { taskId: task.id, name: taskName },
      source: "orchestrator",
    });

    // 2. Select best agent for the task
    const agent = this.selectAgent(task);
    if (!agent) {
      await this.taskRepository.update(task.id, { status: "failed" });
      return {
        taskId: task.id,
        success: false,
        output: null,
        error: "No suitable agent found for task",
        executionTime: 0,
        agentId: "none",
      };
    }

    // 3. Execute via runtime
    return this.runtime.executeTask(task, agent);
  }

  async processPendingTasks(): Promise<TaskResult[]> {
    const pending = await this.taskRepository.findPending(10);
    const results: TaskResult[] = [];

    // Sort by priority weight (higher = more important)
    const sorted = pending.sort((a, b) => b.priority.weight - a.priority.weight);

    for (const task of sorted) {
      const result = await this.delegate(task.name, task.payload, task.priority);
      results.push(result);
    }

    return results;
  }

  private selectAgent(task: Task): IAgent | undefined {
    // Simple selection: find first agent with matching capabilities
    // Future: use more sophisticated matching (v2-08 task delegation)
    const agents = Array.from(this.agents.values());

    if (agents.length === 0) return undefined;

    // Prefer orchestrator for complex tasks, executor for simple ones
    const preferred =
      task.priority.level === "critical"
        ? agents.find((a) => a.role === "orchestrator")
        : agents.find((a) => a.role === "executor");

    return preferred ?? agents[0];
  }
}
