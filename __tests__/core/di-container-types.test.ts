import { describe, expect, it } from "vitest";
import { createAppContainer, registerAdapter } from "../../packages/core/src/ports/di.container.js";
import type { AppConfig, AppContainer } from "../../packages/core/src/ports/di.container.js";
import type { SecretsProvider } from "../../packages/core/src/ports/service.port.js";

class TestSecretsProvider implements SecretsProvider {
  async get(): Promise<string | undefined> {
    return undefined;
  }

  async set(): Promise<void> {}

  async delete(): Promise<void> {}

  async has(): Promise<boolean> {
    return false;
  }
}

class WrongAdapter {
  async read(): Promise<string> {
    return "not a secrets provider";
  }
}

const config: AppConfig = {
  telegram: {
    apiId: 1,
    apiHash: "hash",
  },
  ton: {
    mnemonic: "test",
    network: "testnet",
  },
  llm: {
    provider: "test",
    model: "test",
  },
  database: {
    path: ":memory:",
  },
  api: {
    port: 0,
    host: "127.0.0.1",
  },
  security: {
    jwtSecret: "secret",
    rateLimitWindow: 60,
    rateLimitMax: 10,
  },
  agent: {
    maxIterations: 1,
    timeoutMs: 1000,
  },
};

describe("registerAdapter types", () => {
  it("registers an adapter that implements the selected cradle member", () => {
    const container = createAppContainer(config);

    registerAdapter(container, "secretsProvider", TestSecretsProvider);

    expect(container.resolve("secretsProvider")).toBeInstanceOf(TestSecretsProvider);
  });
});

function verifyRegisterAdapterTypes(container: AppContainer): void {
  // @ts-expect-error - adapter constructors must create the cradle member selected by name.
  registerAdapter(container, "secretsProvider", WrongAdapter);
}

void verifyRegisterAdapterTypes;
