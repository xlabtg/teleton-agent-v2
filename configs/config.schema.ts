/**
 * Configuration schema validation using Zod.
 */

import { z } from "zod";

export const JWT_SECRET_MIN_LENGTH = 32;

export const jwtSecretSchema = z
  .string()
  .min(
    JWT_SECRET_MIN_LENGTH,
    `JWT signing secret must be at least ${JWT_SECRET_MIN_LENGTH} characters long`
  );

export const telegramConfigSchema = z.object({
  api_id: z.number().int().positive(),
  api_hash: z.string().min(1),
  session_string: z.string().optional(),
});

export const tonConfigSchema = z.object({
  network: z.enum(["mainnet", "testnet"]).default("testnet"),
  mnemonic: z.string().optional(),
});

export const llmConfigSchema = z.object({
  provider: z.string().default("anthropic"),
  model: z.string().default("claude-sonnet-4-20250514"),
  api_key: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  max_tokens: z.number().int().positive().default(4096),
});

export const databaseConfigSchema = z.object({
  path: z.string().default("./data/teleton.db"),
});

export const tlsConfigSchema = z.object({
  key_path: z.string(),
  cert_path: z.string(),
  http_redirect_port: z.number().int().min(1).max(65535).optional(),
});

export const apiConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3000),
  host: z.string().default("0.0.0.0"),
  cors: z
    .array(z.string())
    .refine((origins) => !origins.includes("*"), {
      message:
        'CORS misconfiguration: wildcard origin "*" is not allowed. Specify explicit origins instead.',
    })
    .default(["http://localhost:5173"]),
  tls: tlsConfigSchema.optional(),
});

export const securityConfigSchema = z.object({
  jwt_secret: jwtSecretSchema.optional(),
  rate_limit_window: z.number().int().positive().default(900000),
  rate_limit_max: z.number().int().positive().default(100),
});

export const agentConfigSchema = z.object({
  max_iterations: z.number().int().positive().default(20),
  timeout_ms: z.number().int().positive().default(120000),
  personality: z.string().optional(),
});

export const appConfigSchema = z.object({
  telegram: telegramConfigSchema,
  ton: tonConfigSchema.default({}),
  llm: llmConfigSchema.default({}),
  database: databaseConfigSchema.default({}),
  api: apiConfigSchema.default({}),
  security: securityConfigSchema.default({}),
  agent: agentConfigSchema.default({}),
});

export type TlsConfigOutput = z.output<typeof tlsConfigSchema>;
export type AppConfigInput = z.input<typeof appConfigSchema>;
export type AppConfigOutput = z.output<typeof appConfigSchema>;
