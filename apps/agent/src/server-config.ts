import { deriveCsrfConfig, type ServerConfig } from "@teleton/api/server.js";
import type { AppConfig } from "@teleton/core/ports/di.container.js";

export function createAgentServerConfig(
  config: AppConfig,
  runtimeEnv = process.env.NODE_ENV
): ServerConfig {
  return {
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
    csrf: deriveCsrfConfig({ tls: config.api.tls }, runtimeEnv),
    tls: config.api.tls,
  };
}
