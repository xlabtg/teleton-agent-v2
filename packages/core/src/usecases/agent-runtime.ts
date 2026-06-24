/**
 * Agent Runtime - The core agentic loop.
 * Orchestrates the think-act-observe cycle.
 */

import type {
  IAgent,
  AgentContext,
  Action,
  ActionResult,
  Task,
  TaskResult,
  ToolDefinition,
  Message,
} from "../domain/agent.interface.js";
import type { LLMProvider } from "../ports/service.port.js";
import type { MemoryRepository, TaskRepository } from "../ports/repository.port.js";
import type { EventBus } from "../domain/events.js";
import { AgentExecutionError } from "../errors/domain-errors.js";

export interface AgentRuntimeConfig {
  maxIterations: number;
  timeoutMs: number;
  personality?: string;
}

export interface ToolExecutor {
  name: string;
  execute(args: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
}

export class AgentRuntime {
  private readonly toolRegistry = new Map<string, ToolExecutor>();

  constructor(
    private readonly config: AgentRuntimeConfig,
    protected readonly llmProvider: LLMProvider,
    private readonly memoryRepository: MemoryRepository,
    private readonly taskRepository: TaskRepository,
    private readonly eventBus: EventBus
  ) {}

  registerTool(tool: ToolExecutor): void {
    this.toolRegistry.set(tool.name, tool);
  }

  unregisterTool(name: string): void {
    this.toolRegistry.delete(name);
  }

  getRegisteredTools(): ToolDefinition[] {
    return Array.from(this.toolRegistry.entries()).map(([name, _executor]) => ({
      name,
      description: `Tool: ${name}`,
      parameters: {},
      scope: "default",
    }));
  }

  async executeTask(task: Task, agent: IAgent): Promise<TaskResult> {
    const startTime = Date.now();

    await this.taskRepository.update(task.id, { status: "in_progress", assignedAgent: agent.id });
    await this.eventBus.publish({
      id: crypto.randomUUID(),
      type: "task.assigned",
      timestamp: new Date(),
      payload: { taskId: task.id, agentId: agent.id },
      source: "agent-runtime",
    });

    try {
      const context = await this.buildContext(task, agent);
      const result = await this.runAgenticLoop(agent, context);

      await this.taskRepository.update(task.id, { status: "completed" });
      await this.eventBus.publish({
        id: crypto.randomUUID(),
        type: "task.completed",
        timestamp: new Date(),
        payload: { taskId: task.id, agentId: agent.id },
        source: "agent-runtime",
      });

      const taskResult: TaskResult = {
        taskId: task.id,
        success: true,
        output: result,
        executionTime: Date.now() - startTime,
        agentId: agent.id,
      };

      await this.taskRepository.storeResult(taskResult);
      return taskResult;
    } catch (error) {
      await this.taskRepository.update(task.id, { status: "failed" });
      await this.eventBus.publish({
        id: crypto.randomUUID(),
        type: "task.failed",
        timestamp: new Date(),
        payload: { taskId: task.id, agentId: agent.id, error: String(error) },
        source: "agent-runtime",
      });

      return {
        taskId: task.id,
        success: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
        agentId: agent.id,
      };
    }
  }

  async processMessage(messages: Message[], agent: IAgent): Promise<string> {
    const context: AgentContext = {
      sessionId: crypto.randomUUID(),
      userId: "direct",
      conversationHistory: [...messages],
      memory: [],
      availableTools: this.getRegisteredTools(),
      timestamp: new Date(),
    };

    const result = await this.runAgenticLoop(agent, context);
    return typeof result === "string" ? result : JSON.stringify(result);
  }

  private async runAgenticLoop(agent: IAgent, context: AgentContext): Promise<unknown> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(
          new AgentExecutionError(
            `Agent execution timed out after ${this.config.timeoutMs}ms`,
            agent.id
          )
        );
      }, this.config.timeoutMs);
    });

    try {
      return await Promise.race([
        this.runAgenticLoopBody(agent, context, controller.signal),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      controller.abort();
    }
  }

  private async runAgenticLoopBody(
    agent: IAgent,
    context: AgentContext,
    signal: AbortSignal
  ): Promise<unknown> {
    let iterations = 0;
    let lastResult: unknown = null;

    while (iterations < this.config.maxIterations) {
      signal.throwIfAborted();
      iterations++;

      // Think
      const thought = await agent.think(context, { signal });

      signal.throwIfAborted();

      // Act
      const action = await agent.act(thought, { signal });

      signal.throwIfAborted();

      if (action.type === "message") {
        lastResult = action.message;
        break;
      }

      if (action.type === "wait") {
        break;
      }

      // Execute action
      const actionResult = await this.executeAction(action, signal);

      signal.throwIfAborted();

      await this.eventBus.publish({
        id: crypto.randomUUID(),
        type: action.type === "tool_call" ? "tool.completed" : "task.completed",
        timestamp: new Date(),
        payload: {
          agentId: agent.id,
          action: action.type,
          toolName: action.toolName,
          success: actionResult.success,
        },
        source: "agent-runtime",
      });

      // Observe
      const observation = await agent.observe(actionResult, { signal });

      signal.throwIfAborted();

      // Update context with tool result
      context.conversationHistory.push({
        role: "tool",
        content: JSON.stringify(actionResult.output),
        timestamp: new Date(),
        metadata: { toolName: action.toolName },
      });

      lastResult = actionResult.output;

      if (!observation.shouldContinue) {
        break;
      }
    }

    return lastResult;
  }

  private async executeAction(action: Action, signal: AbortSignal): Promise<ActionResult> {
    const startTime = Date.now();

    if (action.type === "tool_call" && action.toolName) {
      const tool = this.toolRegistry.get(action.toolName);
      if (!tool) {
        return {
          success: false,
          output: null,
          error: `Tool '${action.toolName}' not found`,
          duration: Date.now() - startTime,
        };
      }

      try {
        signal.throwIfAborted();
        const output = await tool.execute(action.toolArgs ?? {}, { signal });
        signal.throwIfAborted();
        return {
          success: true,
          output,
          duration: Date.now() - startTime,
        };
      } catch (error) {
        return {
          success: false,
          output: null,
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime,
        };
      }
    }

    return {
      success: false,
      output: null,
      error: `Unsupported action type: ${action.type}`,
      duration: Date.now() - startTime,
    };
  }

  private async buildContext(task: Task, _agent: IAgent): Promise<AgentContext> {
    const relevantMemories = await this.memoryRepository.search(task.name, 10);

    return {
      sessionId: crypto.randomUUID(),
      userId: "system",
      conversationHistory: [
        {
          role: "system",
          content: this.config.personality ?? "You are a helpful AI agent.",
          timestamp: new Date(),
        },
        {
          role: "user",
          content: `Execute task: ${task.name}\n\nPayload: ${JSON.stringify(task.payload)}`,
          timestamp: new Date(),
        },
      ],
      memory: relevantMemories,
      availableTools: this.getRegisteredTools(),
      timestamp: new Date(),
    };
  }
}
