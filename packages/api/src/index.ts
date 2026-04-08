export { createServer } from "./server.js";
export type { ServerConfig } from "./server.js";
export { createAuthMiddleware } from "./middleware/auth.middleware.js";
export type { AuthConfig, UserRole, TokenPayload } from "./middleware/auth.middleware.js";
export {
  createRateLimitMiddleware,
  createAuthRateLimitMiddleware,
  securityHeadersMiddleware,
  requestIdMiddleware,
  createCorsConfig,
} from "./middleware/security.middleware.js";
export type { SecurityConfig, AuthRateLimitConfig } from "./middleware/security.middleware.js";
export { errorHandler } from "./middleware/error-handler.js";
export { createAuthRoutes } from "./routes/auth.js";
export { createDocsRoutes } from "./routes/docs.js";
