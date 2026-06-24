import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeletonApp } from "../../apps/agent/src/index.js";

const HOST = "127.0.0.1";
const TEST_JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_TELETON_JWT_SECRET = process.env.TELETON_JWT_SECRET;

const runningApps: TeletonApp[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(runningApps.map((app) => app.stop().catch(() => {})));
  runningApps.length = 0;

  restoreEnvironment();
  vi.restoreAllMocks();

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("TeletonApp lifecycle", () => {
  it("registers fatal process handlers and removes them on stop", async () => {
    delete process.env.TELETON_JWT_SECRET;
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

  it("refuses to start in production when the JWT secret is missing", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.TELETON_JWT_SECRET;

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

    await expect(app.start(writeConfig(tempDir, port, null))).rejects.toThrow(
      /security\.jwt_secret.*required in production/
    );
    expect(app.isRunning()).toBe(false);
  });

  it("warns and uses an ephemeral JWT secret in development when none is configured", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.TELETON_JWT_SECRET;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

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

    await app.start(writeConfig(tempDir, port, null));

    expect(app.isRunning()).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ephemeral development JWT secret")
    );
  });

  it("lets TELETON_JWT_SECRET override a weak config value in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.TELETON_JWT_SECRET = TEST_JWT_SECRET;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

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

    await app.start(writeConfig(tempDir, port, "secret"));

    expect(app.isRunning()).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
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

function restoreEnvironment(): void {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }

  if (ORIGINAL_TELETON_JWT_SECRET === undefined) {
    delete process.env.TELETON_JWT_SECRET;
  } else {
    process.env.TELETON_JWT_SECRET = ORIGINAL_TELETON_JWT_SECRET;
  }
}

function writeConfig(
  tempDir: string,
  port: number,
  jwtSecret: string | null = TEST_JWT_SECRET
): string {
  const configPath = join(tempDir, "config.yaml");
  const databasePath = join(tempDir, "teleton.db");
  const jwtSecretLine = jwtSecret === null ? "" : `  jwt_secret: ${JSON.stringify(jwtSecret)}\n`;

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
${jwtSecretLine}  rate_limit_window: 60000
  rate_limit_max: 100
agent:
  max_iterations: 1
  timeout_ms: 1000
`
  );

  return configPath;
}
