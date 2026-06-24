import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentOrchestrator } from "../../packages/core/src/usecases/agent-orchestrator.js";
import { AgentRuntime } from "../../packages/core/src/usecases/agent-runtime.js";
import type { IAgent, Task } from "../../packages/core/src/domain/agent.interface.js";
import type { TaskRepository } from "../../packages/core/src/ports/repository.port.js";
import type { EventBus } from "../../packages/core/src/domain/events.js";

function createMockAgent(overrides: Partial<IAgent> = {}): IAgent {
  return {
    id: "test-agent",
    role: "executor",
    capabilities: [],
    constraints: [],
    think: vi.fn().mockResolvedValue({
      reasoning: "test",
      selectedAction: "message",
      confidence: 1,
      alternatives: [],
    }),
    act: vi.fn().mockResolvedValue({
      type: "message" as const,
      message: "done",
    }),
    observe: vi.fn().mockResolvedValue({
      summary: "done",
      shouldContinue: false,
    }),
    ...overrides,
  };
}

function createMockTaskRepo(): TaskRepository {
  const tasks = new Map<string, Task>();
  return {
    create: vi.fn().mockImplementation(async (data) => {
      const task: Task = {
        id: crypto.randomUUID(),
        ...data,
        createdAt: new Date(),
        status: "pending",
      };
      tasks.set(task.id, task);
      return task;
    }),
    findById: vi.fn().mockImplementation(async (id) => tasks.get(id) ?? null),
    findByStatus: vi.fn().mockResolvedValue([]),
    findPending: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockImplementation(async (id, updates) => {
      const task = tasks.get(id);
      if (!task) throw new Error("not found");
      Object.assign(task, updates);
      return task;
    }),
    storeResult: vi.fn().mockResolvedValue(undefined),
    getResult: vi.fn().mockResolvedValue(null),
  };
}

function createMockEventBus(): EventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };
}

describe("AgentOrchestrator", () => {
  let orchestrator: AgentOrchestrator;
  let taskRepo: TaskRepository;
  let eventBus: EventBus;
  let runtime: AgentRuntime;

  beforeEach(() => {
    taskRepo = createMockTaskRepo();
    eventBus = createMockEventBus();

    const memoryRepo = {
      store: vi.fn(),
      findById: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      search: vi.fn().mockResolvedValue([]),
      searchByEmbedding: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      delete: vi.fn(),
      compact: vi.fn(),
    };

    const mockLLM = {
      name: "mock",
      chat: vi.fn(),
      chatStream: vi.fn(),
    };

    runtime = new AgentRuntime(
      { maxIterations: 5, timeoutMs: 10000 },
      mockLLM,
      memoryRepo,
      taskRepo,
      eventBus
    );

    orchestrator = new AgentOrchestrator(runtime, taskRepo, eventBus);
  });

  it("should register and list agents", () => {
    const agent = createMockAgent({ id: "agent-1" });
    orchestrator.registerAgent(agent);

    expect(orchestrator.listAgents()).toHaveLength(1);
    expect(orchestrator.getAgent("agent-1")).toBe(agent);
  });

  it("should unregister agents", () => {
    const agent = createMockAgent({ id: "agent-1" });
    orchestrator.registerAgent(agent);
    orchestrator.unregisterAgent("agent-1");

    expect(orchestrator.listAgents()).toHaveLength(0);
    expect(orchestrator.getAgent("agent-1")).toBeUndefined();
  });

  it("should fail delegation when no agents registered", async () => {
    const result = await orchestrator.delegate("test-task", { data: "test" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No suitable agent");
  });

  it("should create task and publish event on delegation", async () => {
    const agent = createMockAgent();
    orchestrator.registerAgent(agent);

    await orchestrator.delegate("test-task", { data: "test" });

    expect(taskRepo.create).toHaveBeenCalledWith(expect.objectContaining({ name: "test-task" }));
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "task.created" })
    );
  });
});
