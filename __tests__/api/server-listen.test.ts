import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { startServer, type ServerConfig } from "../../packages/api/src/server.js";

const HOST = "127.0.0.1";

const BASE_CONFIG: ServerConfig = {
  port: 0,
  host: HOST,
  auth: {
    jwtSecret: "test-secret",
    tokenExpiry: 3600,
    refreshTokenExpiry: 604800,
  },
  security: {
    rateLimitWindow: 60_000,
    rateLimitMax: 100,
    corsOrigins: [],
  },
};

let occupiedServers: HttpServer[] = [];

afterEach(async () => {
  await Promise.all(occupiedServers.map(closeServer));
  occupiedServers = [];
});

describe("startServer listen errors", () => {
  it("rejects instead of hanging when the HTTP port is already in use", async () => {
    const port = await occupyRandomPort();
    const app = new Hono();
    const startAttempt = withSettlementTimeout(
      startServer(app, {
        ...BASE_CONFIG,
        port,
      })
    );

    await expect(startAttempt).rejects.toMatchObject({ code: "EADDRINUSE" });
  });

  it("returns a handle that closes the HTTP server", async () => {
    const app = new Hono();
    app.get("/", (ctx) => ctx.text("ok"));

    const server = await startServer(app, BASE_CONFIG);

    try {
      const response = await fetch(`http://${HOST}:${server.port}/`);
      expect(await response.text()).toBe("ok");
    } finally {
      await server.close();
    }

    await expect(fetch(`http://${HOST}:${server.port}/`)).rejects.toThrow();
  });
});

async function occupyRandomPort(): Promise<number> {
  const server = createHttpServer((_req, res) => {
    res.end("occupied");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      server.off("error", reject);
      occupiedServers.push(server);
      resolve();
    });
  });

  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("Could not determine occupied test port");
  }

  return address.port;
}

async function closeServer(server: HttpServer): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function withSettlementTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("startServer did not settle after listen error"));
    }, 1_000);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}
