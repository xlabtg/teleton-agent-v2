// V2-14: Comprehensive Audit Logging
export { createAuditEvent, redactSensitiveFields, DEFAULT_SENSITIVE_KEYS } from "./audit-event.js";
export type {
  AuditEvent,
  AuditActor,
  AuditResource,
  AuditCategory,
  AuditOutcome,
  AuditSeverity,
} from "./audit-event.js";
export { AuditStore } from "./audit-store.js";
export type { AuditStoreConfig, StoredAuditEvent } from "./audit-store.js";
export { AuditLogger } from "./audit-logger.js";
export type { AuditLoggerConfig, AuditLogLevel } from "./audit-logger.js";
export { AuditQuery } from "./audit-query.js";
export type { AuditQueryFilter, AuditQueryOptions, AuditQueryResult } from "./audit-query.js";

// V2-13: Zero-Trust Input Validation
export { InputValidator } from "./input-validator.js";
export type {
  InputValidatorConfig,
  ValidatedInput,
  ValidationStageResult,
  FieldValidator,
} from "./input-validator.js";
export { InjectionDetector } from "./injection-detector.js";
export type {
  InjectionDetectorConfig,
  DetectionResult,
  InjectionAction,
  InjectionClassification,
  ClassifierFn,
} from "./injection-detector.js";
export { AuthorizationMiddleware } from "./authorization-middleware.js";
export type {
  AuthorizationMiddlewareConfig,
  AuthorizationActor,
  AuthorizationResult,
  RoleDefinition,
  PolicyContext,
  PolicyFn,
  Permission,
} from "./authorization-middleware.js";
export { RateLimiter } from "./rate-limiter.js";
export type { RateLimiterConfig, RateLimitWindow, RateLimitStatus } from "./rate-limiter.js";
