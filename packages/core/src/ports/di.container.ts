/**
 * Dependency Injection container setup.
 * Uses awilix for IoC container management.
 */

import { createContainer, asValue, asClass, type AwilixContainer, InjectionMode } from "awilix";
import type {
  LLMProvider,
  TelegramBridge,
  TonWallet,
  SecretsProvider,
  EmbeddingProvider,
} from "./service.port.js";
import type {
  MemoryRepository,
  TaskRepository,
  SessionRepository,
  EventRepository,
} from "./repository.port.js";
import type { EventBus } from "../domain/events.js";

export interface AppConfig {
  telegram: {
    apiId: number;
    apiHash: string;
    sessionString?: string;
  };
  ton: {
    mnemonic: string;
    network: "mainnet" | "testnet";
  };
  llm: {
    provider: string;
    model: string;
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
  };
  database: {
    path: string;
  };
  api: {
    port: number;
    host: string;
    cors?: string[];
  };
  security: {
    jwtSecret: string;
    rateLimitWindow: number;
    rateLimitMax: number;
  };
  agent: {
    maxIterations: number;
    timeoutMs: number;
    personality?: string;
  };
}

export interface CradleInterface {
  config: AppConfig;
  llmProvider: LLMProvider;
  telegramBridge: TelegramBridge;
  tonWallet: TonWallet;
  secretsProvider: SecretsProvider;
  embeddingProvider: EmbeddingProvider;
  memoryRepository: MemoryRepository;
  taskRepository: TaskRepository;
  sessionRepository: SessionRepository;
  eventRepository: EventRepository;
  eventBus: EventBus;
}

export type AppContainer = AwilixContainer<CradleInterface>;

export function createAppContainer(config: AppConfig): AppContainer {
  const container = createContainer<CradleInterface>({
    injectionMode: InjectionMode.CLASSIC,
  });

  container.register("config", asValue(config));

  return container;
}

/**
 * Register an infrastructure adapter in the container.
 */
export function registerAdapter<K extends keyof CradleInterface>(
  container: AppContainer,
  name: K,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  implementation: any
): void {
  container.register(name, asClass(implementation).singleton());
}
