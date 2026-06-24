import { describe, expect, it } from "vitest";
import { createAgentServerConfig } from "../../apps/agent/src/server-config.js";
import type { AppConfig } from "../../packages/core/src/ports/di.container.js";

const BASE_APP_CONFIG: AppConfig = {
  telegram: {
    apiId: 1,
    apiHash: "test-api-hash",
  },
  ton: {
    mnemonic: "",
    network: "testnet",
  },
  llm: {
    provider: "test",
    model: "test-model",
  },
  database: {
    path: ":memory:",
  },
  api: {
    port: 3000,
    host: "127.0.0.1",
    cors: ["http://localhost:5173"],
  },
  security: {
    jwtSecret: "test-secret-key",
    rateLimitWindow: 60_000,
    rateLimitMax: 100,
  },
  agent: {
    maxIterations: 20,
    timeoutMs: 120_000,
  },
};

describe("createAgentServerConfig", () => {
  it("passes secure CSRF cookie config when TLS is configured", () => {
    const serverConfig = createAgentServerConfig(
      {
        ...BASE_APP_CONFIG,
        api: {
          ...BASE_APP_CONFIG.api,
          tls: {
            keyPath: "/tmp/test-key.pem",
            certPath: "/tmp/test-cert.pem",
          },
        },
      },
      "development"
    );

    expect(serverConfig.csrf?.secureCookie).toBe(true);
  });

  it("passes secure CSRF cookie config in production without TLS", () => {
    const serverConfig = createAgentServerConfig(BASE_APP_CONFIG, "production");

    expect(serverConfig.csrf?.secureCookie).toBe(true);
  });

  it("keeps CSRF cookies non-secure for local development without TLS", () => {
    const serverConfig = createAgentServerConfig(BASE_APP_CONFIG, "development");

    expect(serverConfig.csrf?.secureCookie).toBe(false);
  });
});
