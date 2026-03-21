/**
 * Teleton Agent V2 — Plugin SDK
 *
 * This SDK provides the interfaces and utilities for building
 * third-party plugins for the Teleton Agent.
 */

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  tools?: PluginToolDefinition[];
  hooks?: PluginHookDefinition[];
}

export interface PluginToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  scope?: string;
}

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
  default?: unknown;
}

export interface PluginHookDefinition {
  event: string;
  handler: string;
}

export interface PluginContext {
  logger: PluginLogger;
  config: Record<string, unknown>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface PluginLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export interface Plugin {
  manifest: PluginManifest;
  activate(context: PluginContext): Promise<void>;
  deactivate(): Promise<void>;
}

/**
 * Helper to define a plugin with type safety.
 */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
