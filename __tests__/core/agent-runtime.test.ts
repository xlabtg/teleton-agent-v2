import { describe, it, expect, vi } from "vitest";
import { AgentRuntime } from "../../packages/core/src/usecases/agent-runtime.js";
import type { AgentContext, IAgent, Task } from "../../packages/core/src/domain/agent.interface.js";
import type { EventBus } from "../../packages/core/src/domain/events.js";
import type {
  MemoryRepository,
  TaskRepository,
} from "../../packages/core/src/ports/repository.port.js";

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

function createTask(): Task {
  return {
    id: "task-1",
    name: "slow task",
    payload: {},
    priority: { level: "normal", weight: 1 },
    createdAt: new Date(),
    status: "pending",
  };
}

function createAgent(overrides: Partial<IAgent> = {}): IAgent {
  return {
    id: "agent-1",
    role: "executor",
    capabilities: [],
    constraints: [],
    think: vi.fn().mockResolvedValue({
      reasoning: "done",
      selectedAction: "message",
      confidence: 1,
      alternatives: [],
    }),
    act: vi.fn().mockResolvedValue({ type: "message", message: "done" }),
    observe: vi.fn().mockResolvedValue({ summary: "done", shouldContinue: false }),
    ...overrides,
  };
}

function createRuntime(timeoutMs = 20): {
  runtime: AgentRuntime;
  taskRepository: TaskRepository;
  eventBus: EventBus;
} {
  const taskRepository: TaskRepository = {
    create: vi.fn(),
    findById: vi.fn(),
    findByStatus: vi.fn(),
    findPending: vi.fn(),
    update: vi.fn().mockResolvedValue(createTask()),
    storeResult: vi.fn().mockResolvedValue(undefined),
    getResult: vi.fn(),
  };

  const memoryRepository: MemoryRepository = {
    store: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    searchByEmbedding: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    compact: vi.fn(),
  };

  const eventBus: EventBus = {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };

  const llmProvider = {
    name: "mock",
    chat: vi.fn(),
    chatStream: vi.fn(),
  };

  return {
    runtime: new AgentRuntime(
      { maxIterations: 3, timeoutMs },
      llmProvider,
      memoryRepository,
      taskRepository,
      eventBus
    ),
    taskRepository,
    eventBus,
  };
}

describe("AgentRuntime", () => {
  it("marks the task failed and publishes task.failed when the agent loop times out", async () => {
    const { runtime, taskRepository, eventBus } = createRuntime();
    const agent = createAgent({
      think: vi
        .fn()
        .mockImplementation((_context: AgentContext, options?: { signal?: AbortSignal }) => {
          expect(options?.signal).toBeInstanceOf(AbortSignal);
          return waitForAbort(options!.signal!);
        }),
    });

    const result = await runtime.executeTask(createTask(), agent);

    expect(result).toMatchObject({
      taskId: "task-1",
      success: false,
      output: null,
      agentId: "agent-1",
    });
    expect(result.error).toBe("Agent execution timed out after 20ms");
    expect(taskRepository.update).toHaveBeenCalledWith("task-1", {
      status: "failed",
    });
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.failed",
        payload: expect.objectContaining({
          taskId: "task-1",
          agentId: "agent-1",
          error: expect.stringContaining("Agent execution timed out after 20ms"),
        }),
      })
    );
  });

  it("passes the abort signal into tool execution and aborts it on timeout", async () => {
    const { runtime } = createRuntime();
    const execute = vi.fn().mockImplementation((_args, options?: { signal?: AbortSignal }) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      return waitForAbort(options!.signal!);
    });

    runtime.registerTool({ name: "slow-tool", execute });

    const agent = createAgent({
      act: vi.fn().mockResolvedValue({
        type: "tool_call",
        toolName: "slow-tool",
        toolArgs: { value: true },
      }),
    });

    const result = await runtime.executeTask(createTask(), agent);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Agent execution timed out after 20ms");
    expect(execute).toHaveBeenCalledWith({ value: true }, { signal: expect.any(AbortSignal) });
  });
});
