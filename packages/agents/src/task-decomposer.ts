/**
 * Task Decomposer — V2-08.
 * Analyses an incoming task description and breaks it into a list of
 * self-contained subtasks, each annotated with the capability it requires.
 *
 * The decomposition is rule-based by default (keyword heuristics) so the
 * module has no external runtime dependencies and is testable without an LLM.
 * A custom `DecompositionStrategy` can be injected to plug in an LLM-backed
 * decomposer when higher fidelity is needed.
 */

export interface SubTask {
  id: string;
  /** Short human-readable name. */
  name: string;
  /** Full description that will be sent to the delegate agent. */
  description: string;
  /** Capability name required to handle this subtask (e.g. "code-review"). */
  requiredCapability: string;
  /** Dependencies: ids of subtasks that must complete before this one starts. */
  dependsOn: string[];
  /** Payload forwarded to the delegate. */
  payload: Record<string, unknown>;
  /** Priority weight copied from or derived from the parent task. */
  priorityWeight: number;
}

export interface DecomposedTask {
  /** Original task id. */
  taskId: string;
  subtasks: SubTask[];
  /** True when the task was identified as a simple single-domain request. */
  isFastPath: boolean;
}

/**
 * Pluggable strategy interface.
 * Implement this to swap in LLM-based or rule-based decomposition logic.
 */
export type DecompositionStrategy = (
  taskName: string,
  payload: Record<string, unknown>
) => SubTask[];

export interface TaskDecomposerConfig {
  /**
   * Maximum decomposition depth (not used for the default rule-based strategy
   * but passed through to custom strategies). Default: 3.
   */
  maxDepth?: number;
  /**
   * Custom decomposition strategy. Defaults to the built-in keyword heuristic.
   */
  strategy?: DecompositionStrategy;
}

/** Built-in heuristic: one subtask per top-level key in the payload. */
function defaultStrategy(taskName: string, payload: Record<string, unknown>): SubTask[] {
  const keys = Object.keys(payload);

  if (keys.length <= 1) {
    return [
      {
        id: crypto.randomUUID(),
        name: taskName,
        description: taskName,
        requiredCapability: taskName.toLowerCase().replace(/\s+/g, "-"),
        dependsOn: [],
        payload,
        priorityWeight: 50,
      },
    ];
  }

  return keys.map((key, idx) => ({
    id: crypto.randomUUID(),
    name: `${taskName}:${key}`,
    description: `Handle "${key}" portion of task "${taskName}"`,
    requiredCapability: key.toLowerCase().replace(/\s+/g, "-"),
    dependsOn: idx === 0 ? [] : [], // parallel by default
    payload: { [key]: payload[key] },
    priorityWeight: 50,
  }));
}

export class TaskDecomposer {
  private readonly maxDepth: number;
  private readonly strategy: DecompositionStrategy;

  constructor(config: TaskDecomposerConfig = {}) {
    this.maxDepth = config.maxDepth ?? 3;
    this.strategy = config.strategy ?? defaultStrategy;
  }

  /**
   * Decompose a task into subtasks.
   * If the task maps to a single subtask (fast path), `isFastPath` is true
   * and no delegation overhead is incurred.
   */
  decompose(taskId: string, taskName: string, payload: Record<string, unknown>): DecomposedTask {
    const subtasks = this.strategy(taskName, payload);
    const isFastPath = subtasks.length === 1;
    return { taskId, subtasks, isFastPath };
  }

  get configuredMaxDepth(): number {
    return this.maxDepth;
  }
}
