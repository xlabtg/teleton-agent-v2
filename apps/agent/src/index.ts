/**
 * Teleton Agent V2 — Main application entry point.
 * Bootstraps all services and starts the agent.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { createAppContainer, type AppConfig } from "@teleton/core/ports/di.container.js";
import { AgentRuntime } from "@teleton/core/usecases/agent-runtime.js";
import { AgentOrchestrator } from "@teleton/core/usecases/agent-orchestrator.js";
import {
  SQLiteMemoryRepository,
  SQLiteTaskRepository,
} from "@teleton/infrastructure/database/sqlite.adapter.js";
import { InMemoryEventBus } from "@teleton/infrastructure/events/in-memory-event-bus.js";
import { createServer, startServer, type ServerHandle } from "@teleton/api/server.js";
import { appConfigSchema } from "../../../configs/config.schema.js";
import { createAgentServerConfig } from "./server-config.js";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

interface CloseableResource {
  name: string;
  close(): Promise<void> | void;
}

export interface TeletonAppOptions {
  shutdownTimeoutMs?: number;
  exitProcess?: (code: number) => never;
}

export class TeletonApp {
  private running = false;
  private resources: CloseableResource[] = [];
  private unregisterProcessHandlers?: () => void;
  private shutdownPromise?: Promise<void>;

  constructor(private readonly options: TeletonAppOptions = {}) {}

  isRunning(): boolean {
    return this.running;
  }

  async start(configPath?: string): Promise<void> {
    console.log("🚀 Starting Teleton Agent V2...\n");

    // 1. Load configuration
    const config = this.loadConfig(configPath);
    console.log("✅ Configuration loaded");

    // 2. Create DI container
    createAppContainer(config);
    console.log("✅ DI container created");

    // 3. Initialize infrastructure
    const eventBus = new InMemoryEventBus();
    const memoryRepo = new SQLiteMemoryRepository(config.database.path);
    const taskRepo = new SQLiteTaskRepository(config.database.path);
    const resources: CloseableResource[] = [
      { name: "event bus", close: () => eventBus.close() },
      { name: "memory repository", close: () => memoryRepo.close() },
      { name: "task repository", close: () => taskRepo.close() },
    ];
    console.log("✅ Infrastructure initialized");

    try {
      // 4. Create runtime and orchestrator
      const runtime = new AgentRuntime(
        {
          maxIterations: config.agent.maxIterations,
          timeoutMs: config.agent.timeoutMs,
          personality: config.agent.personality,
        },
        // TODO: Wire actual LLM provider
        null as never,
        memoryRepo,
        taskRepo,
        eventBus
      );

      new AgentOrchestrator(runtime, taskRepo, eventBus);
      console.log("✅ Agent runtime created");

      // 5. Start API server
      const serverConfig = createAgentServerConfig(config);
      const app = createServer(serverConfig);
      const apiServer: ServerHandle = await startServer(app, serverConfig);
      resources.push({ name: "API server", close: () => apiServer.close() });
    } catch (error) {
      await this.closeResources([...resources].reverse());
      throw error;
    }

    // 6. Mark as running
    this.resources = resources;
    this.running = true;
    this.registerProcessHandlers();
    console.log("\n🤖 Teleton Agent V2 is ready!\n");
  }

  async stop(): Promise<void> {
    this.unregisterProcessHandlers?.();
    this.unregisterProcessHandlers = undefined;
    this.running = false;

    const resources = this.resources.splice(0).reverse();
    await this.closeResources(resources);
  }

  private registerProcessHandlers(): void {
    this.unregisterProcessHandlers?.();

    const shutdownOnSignal = (signal: NodeJS.Signals) => {
      void this.shutdown(signal, 0);
    };
    const shutdownOnUnhandledRejection = (reason: unknown) => {
      console.error("Unhandled promise rejection:", reason);
      void this.shutdown("unhandledRejection", 1);
    };
    const shutdownOnUncaughtException = (error: Error) => {
      console.error("Uncaught exception:", error);
      void this.shutdown("uncaughtException", 1);
    };

    process.on("SIGINT", shutdownOnSignal);
    process.on("SIGTERM", shutdownOnSignal);
    process.on("unhandledRejection", shutdownOnUnhandledRejection);
    process.on("uncaughtException", shutdownOnUncaughtException);

    this.unregisterProcessHandlers = () => {
      process.off("SIGINT", shutdownOnSignal);
      process.off("SIGTERM", shutdownOnSignal);
      process.off("unhandledRejection", shutdownOnUnhandledRejection);
      process.off("uncaughtException", shutdownOnUncaughtException);
    };
  }

  private shutdown(reason: string, exitCode: number): Promise<void> {
    this.shutdownPromise ??= this.performShutdown(reason, exitCode);
    return this.shutdownPromise;
  }

  private async performShutdown(reason: string, exitCode: number): Promise<void> {
    console.log(`\n🛑 Shutting down after ${reason}...`);

    const timeout = setTimeout(() => {
      console.error(`Shutdown timed out after ${this.shutdownTimeoutMs}ms, forcing process exit.`);
      this.exitProcess(1);
    }, this.shutdownTimeoutMs);
    timeout.unref();

    try {
      await this.stop();
      clearTimeout(timeout);
      this.exitProcess(exitCode);
    } catch (error) {
      clearTimeout(timeout);
      console.error("Shutdown cleanup failed:", error);
      this.exitProcess(exitCode === 0 ? 1 : exitCode);
    }
  }

  private async closeResources(resources: CloseableResource[]): Promise<void> {
    const failures: unknown[] = [];

    for (const resource of resources) {
      try {
        await resource.close();
      } catch (error) {
        failures.push(new Error(`Failed to close ${resource.name}`, { cause: error }));
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, "Failed to close application resources");
    }
  }

  private get shutdownTimeoutMs(): number {
    return this.options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  }

  private exitProcess(code: number): never {
    return (this.options.exitProcess ?? process.exit)(code);
  }

  private loadConfig(configPath?: string): AppConfig {
    const paths = [
      configPath,
      resolve(process.env.HOME ?? process.env.USERPROFILE ?? "", ".teleton-v2/config.yaml"),
      resolve(process.cwd(), "configs/default.yaml"),
    ].filter(Boolean) as string[];

    for (const p of paths) {
      if (existsSync(p)) {
        const raw = readFileSync(p, "utf-8");
        const parsed = parseYaml(raw);
        const validated = appConfigSchema.parse(parsed);

        // Map YAML snake_case to camelCase config
        return {
          telegram: {
            apiId: validated.telegram.api_id,
            apiHash: validated.telegram.api_hash,
            sessionString: validated.telegram.session_string,
          },
          ton: {
            mnemonic: validated.ton.mnemonic ?? "",
            network: validated.ton.network,
          },
          llm: {
            provider: validated.llm.provider,
            model: validated.llm.model,
            apiKey: validated.llm.api_key,
            temperature: validated.llm.temperature,
            maxTokens: validated.llm.max_tokens,
          },
          database: {
            path: validated.database.path,
          },
          api: {
            port: validated.api.port,
            host: validated.api.host,
            cors: validated.api.cors,
            tls: validated.api.tls
              ? {
                  keyPath: validated.api.tls.key_path,
                  certPath: validated.api.tls.cert_path,
                  httpRedirectPort: validated.api.tls.http_redirect_port,
                }
              : undefined,
          },
          security: {
            jwtSecret: validated.security.jwt_secret ?? crypto.randomUUID(),
            rateLimitWindow: validated.security.rate_limit_window,
            rateLimitMax: validated.security.rate_limit_max,
          },
          agent: {
            maxIterations: validated.agent.max_iterations,
            timeoutMs: validated.agent.timeout_ms,
            personality: validated.agent.personality,
          },
        };
      }
    }

    throw new Error("No configuration file found. Create ~/.teleton-v2/config.yaml");
  }
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && import.meta.url === pathToFileURL(entrypoint).href);
}

if (isDirectExecution()) {
  const app = new TeletonApp();
  app.start().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
