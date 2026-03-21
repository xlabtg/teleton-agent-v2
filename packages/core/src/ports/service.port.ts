/**
 * Service port interfaces.
 * These define the contracts for external service integrations.
 */

import type { Message, ToolDefinition } from "../domain/agent.interface.js";

export interface LLMProvider {
  readonly name: string;

  chat(
    messages: Message[],
    options?: LLMChatOptions
  ): Promise<LLMResponse>;

  chatStream(
    messages: Message[],
    options?: LLMChatOptions
  ): AsyncIterable<LLMStreamChunk>;
}

export interface LLMChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  systemPrompt?: string;
  stopSequences?: string[];
}

export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  finishReason: "stop" | "tool_call" | "max_tokens" | "error";
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMStreamChunk {
  type: "text" | "tool_call_start" | "tool_call_delta" | "tool_call_end" | "done";
  content?: string;
  toolCall?: Partial<LLMToolCall>;
}

export interface TelegramBridge {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  sendMessage(chatId: string, text: string): Promise<void>;
  onMessage(handler: (message: IncomingMessage) => Promise<void>): void;
}

export interface IncomingMessage {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  timestamp: Date;
  replyToId?: string;
}

export interface TonWallet {
  getBalance(): Promise<bigint>;
  transfer(to: string, amount: bigint, payload?: string): Promise<string>;
  getAddress(): string;
}

export interface SecretsProvider {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions(): number;
}
