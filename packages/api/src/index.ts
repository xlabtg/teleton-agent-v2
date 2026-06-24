export { createServer, startServer, warnIfInsecure } from "./server.js";
export type { ServerConfig, ServerHandle, TlsConfig } from "./server.js";
export { createAuthMiddleware } from "./middleware/auth.middleware.js";
export type {
  AuthConfig,
  AuthUserRecord,
  AuthUserStore,
  UserRole,
  TokenPayload,
} from "./middleware/auth.middleware.js";
export {
  createRateLimitMiddleware,
  createAuthRateLimitMiddleware,
  securityHeadersMiddleware,
  requestIdMiddleware,
  createCorsConfig,
} from "./middleware/security.middleware.js";
export type { SecurityConfig, AuthRateLimitConfig } from "./middleware/security.middleware.js";
export { errorHandler } from "./middleware/error-handler.js";
export {
  createAuthRoutes,
  createStaticUserStore,
  hashPassword,
  verifyPasswordHash,
} from "./routes/auth.js";
export { createDocsRoutes } from "./routes/docs.js";
