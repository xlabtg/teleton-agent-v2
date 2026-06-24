import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeletonApp } from "../../apps/agent/src/index.js";

const HOST = "127.0.0.1";

const runningApps: TeletonApp[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(runningApps.map((app) => app.stop().catch(() => {})));
  runningApps.length = 0;

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("TeletonApp lifecycle", () => {
  it("registers fatal process handlers and removes them on stop", async () => {
    const initialUnhandledRejectionHandlers = process.listenerCount("unhandledRejection");
    const initialUncaughtExceptionHandlers = process.listenerCount("uncaughtException");
    const initialSigintHandlers = process.listenerCount("SIGINT");
    const initialSigtermHandlers = process.listenerCount("SIGTERM");
    const tempDir = mkdtempSync(join(tmpdir(), "teleton-app-"));
    tempDirs.push(tempDir);
    const port = await findFreePort();
    const app = new TeletonApp({
      shutdownTimeoutMs: 100,
      exitProcess: vi.fn((code: number) => {
        throw new Error(`Unexpected process exit ${code}`);
      }) as (code: number) => never,
    });
    runningApps.push(app);

    await app.start(writeConfig(tempDir, port));

    expect(app.isRunning()).toBe(true);
    expect(process.listenerCount("unhandledRejection")).toBe(initialUnhandledRejectionHandlers + 1);
    expect(process.listenerCount("uncaughtException")).toBe(initialUncaughtExceptionHandlers + 1);
    expect(process.listenerCount("SIGINT")).toBe(initialSigintHandlers + 1);
    expect(process.listenerCount("SIGTERM")).toBe(initialSigtermHandlers + 1);

    const response = await fetch(`http://${HOST}:${port}/`);
    expect(response.ok).toBe(true);

    await app.stop();

    expect(app.isRunning()).toBe(false);
    expect(process.listenerCount("unhandledRejection")).toBe(initialUnhandledRejectionHandlers);
    expect(process.listenerCount("uncaughtException")).toBe(initialUncaughtExceptionHandlers);
    expect(process.listenerCount("SIGINT")).toBe(initialSigintHandlers);
    expect(process.listenerCount("SIGTERM")).toBe(initialSigtermHandlers);
    await expect(fetch(`http://${HOST}:${port}/`)).rejects.toThrow();
  });
});

async function findFreePort(): Promise<number> {
  const server = createHttpServer((_req, res) => {
    res.end("reserved");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("Could not determine free test port");
  }

  await closeServer(server);
  return address.port;
}

function closeServer(server: HttpServer): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function writeConfig(tempDir: string, port: number): string {
  const configPath = join(tempDir, "config.yaml");
  const databasePath = join(tempDir, "teleton.db");

  writeFileSync(
    configPath,
    `
telegram:
  api_id: 1
  api_hash: "test-api-hash"
database:
  path: ${JSON.stringify(databasePath)}
api:
  port: ${port}
  host: "${HOST}"
  cors: []
security:
  jwt_secret: "test-secret-key"
  rate_limit_window: 60000
  rate_limit_max: 100
agent:
  max_iterations: 1
  timeout_ms: 1000
`
  );

  return configPath;
}
