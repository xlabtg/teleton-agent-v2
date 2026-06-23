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
import { createServer, startServer } from "@teleton/api/server.js";
import { appConfigSchema } from "../../../configs/config.schema.js";

export class TeletonApp {
  private running = false;

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
    console.log("✅ Infrastructure initialized");

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
    const serverConfig = {
      port: config.api.port,
      host: config.api.host,
      auth: {
        jwtSecret: config.security.jwtSecret,
        tokenExpiry: 3600,
        refreshTokenExpiry: 604800,
      },
      security: {
        rateLimitWindow: config.security.rateLimitWindow,
        rateLimitMax: config.security.rateLimitMax,
        corsOrigins: config.api.cors ?? [],
      },
      tls: config.api.tls,
    };

    const app = createServer(serverConfig);
    await startServer(app, serverConfig);

    // 6. Mark as running
    this.running = true;
    console.log("\n🤖 Teleton Agent V2 is ready!\n");

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log("\n🛑 Shutting down...");
      this.running = false;
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
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
