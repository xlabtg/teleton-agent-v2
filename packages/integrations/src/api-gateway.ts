/**
 * API Gateway — V2-15.
 * Universal API client orchestrator that normalises access to all external services
 * behind a consistent interface.  Handles authentication via CredentialManager,
 * resilience via CircuitBreaker, and observability via request/response interceptors.
 */

import { ValidationError, NotFoundError } from "../../core/src/errors/domain-errors.js";
import type { ApiAdapter, ApiRequest, ApiResponse } from "./api-adapter.js";
import { CredentialManager } from "./credential-manager.js";
import { CircuitBreaker, type CircuitBreakerConfig } from "./circuit-breaker.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RequestInterceptor {
  (request: ApiRequest, serviceId: string): ApiRequest | Promise<ApiRequest>;
}

export interface ResponseInterceptor {
  (response: ApiResponse, serviceId: string): ApiResponse | Promise<ApiResponse>;
}

export interface UsageRecord {
  serviceId: string;
  method: ApiRequest["method"];
  path: string;
  status: number;
  durationMs: number;
  timestamp: string;
}

export interface ApiGatewayConfig {
  /** Pre-seeded credentials. Forwarded to the internal CredentialManager. */
  credentials?: Record<string, unknown>;
  /** Per-service circuit breaker settings. Key is serviceId. */
  circuitBreakers?: Record<string, CircuitBreakerConfig>;
  /** Default circuit breaker settings applied to every service. */
  defaultCircuitBreaker?: CircuitBreakerConfig;
  /** Maximum number of usage records to retain in memory. Defaults to 1 000. */
  maxUsageRecords?: number;
}

// ---------------------------------------------------------------------------
// ApiGateway
// ---------------------------------------------------------------------------

/**
 * Central point for all external API calls.  Adapters are registered once;
 * callers invoke `execute(serviceId, request)` without knowing adapter details.
 *
 * @example
 * const gateway = new ApiGateway({ credentials: { openai: { apiKey: "sk-..." } } });
 * gateway.register(new OpenAiAdapter());
 * const response = await gateway.execute("openai", { method: "POST", path: "/v1/chat/completions", body: {...} });
 */
export class ApiGateway {
  readonly credentials: CredentialManager;
  private readonly adapters = new Map<string, ApiAdapter>();
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly requestInterceptors: RequestInterceptor[] = [];
  private readonly responseInterceptors: ResponseInterceptor[] = [];
  private readonly usageLog: UsageRecord[] = [];
  private readonly maxUsageRecords: number;
  private readonly defaultCbConfig: CircuitBreakerConfig;
  private readonly perServiceCbConfig: Record<string, CircuitBreakerConfig>;

  constructor(config: ApiGatewayConfig = {}) {
    this.credentials = new CredentialManager({
      initial: config.credentials,
    });
    this.maxUsageRecords = config.maxUsageRecords ?? 1_000;
    this.defaultCbConfig = config.defaultCircuitBreaker ?? {};
    this.perServiceCbConfig = config.circuitBreakers ?? {};
  }

  // ---------------------------------------------------------------------------
  // Adapter registry
  // ---------------------------------------------------------------------------

  /** Register an adapter for a service. Overwrites any existing adapter. */
  register(adapter: ApiAdapter): void {
    const id = adapter.meta.serviceId;
    this.adapters.set(id, adapter);
    const cbConfig = { ...this.defaultCbConfig, ...(this.perServiceCbConfig[id] ?? {}) };
    this.breakers.set(id, new CircuitBreaker(cbConfig));
  }

  /** Deregister an adapter. Returns true if it existed. */
  deregister(serviceId: string): boolean {
    this.breakers.delete(serviceId);
    return this.adapters.delete(serviceId);
  }

  /** Return registered service IDs. */
  listServices(): string[] {
    return Array.from(this.adapters.keys());
  }

  // ---------------------------------------------------------------------------
  // Interceptors
  // ---------------------------------------------------------------------------

  /** Add a request interceptor. Interceptors run in insertion order. */
  addRequestInterceptor(fn: RequestInterceptor): void {
    this.requestInterceptors.push(fn);
  }

  /** Add a response interceptor. Interceptors run in insertion order. */
  addResponseInterceptor(fn: ResponseInterceptor): void {
    this.responseInterceptors.push(fn);
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  /**
   * Execute a request through the registered adapter for `serviceId`.
   * @throws NotFoundError if no adapter is registered.
   * @throws ValidationError if the stored credential is invalid for the adapter.
   */
  async execute<T = unknown>(serviceId: string, request: ApiRequest): Promise<ApiResponse<T>> {
    const adapter = this.adapters.get(serviceId);
    if (!adapter) {
      throw new NotFoundError("Adapter", serviceId);
    }

    const credential = this.credentials.get(serviceId);
    if (!adapter.validateCredential(credential)) {
      throw new ValidationError(
        `Credential for service "${serviceId}" failed validation.`
      );
    }

    // Run request interceptors.
    let req = request;
    for (const interceptor of this.requestInterceptors) {
      req = await interceptor(req, serviceId);
    }

    const breaker = this.breakers.get(serviceId)!;

    const rawResponse = await breaker.call(() =>
      adapter.execute<T>(req, credential)
    );

    // Run response interceptors.
    let res = rawResponse as ApiResponse;
    for (const interceptor of this.responseInterceptors) {
      res = await interceptor(res, serviceId);
    }

    this._recordUsage(serviceId, req, res);
    return res as ApiResponse<T>;
  }

  // ---------------------------------------------------------------------------
  // Usage tracking
  // ---------------------------------------------------------------------------

  /** Return a copy of all usage records (most recent last). */
  getUsageLog(): UsageRecord[] {
    return this.usageLog.slice();
  }

  /** Return usage totals aggregated by service. */
  getUsageSummary(): Record<string, { calls: number; totalDurationMs: number; errorCount: number }> {
    const summary: Record<string, { calls: number; totalDurationMs: number; errorCount: number }> =
      {};
    for (const rec of this.usageLog) {
      if (!summary[rec.serviceId]) {
        summary[rec.serviceId] = { calls: 0, totalDurationMs: 0, errorCount: 0 };
      }
      const s = summary[rec.serviceId];
      s.calls++;
      s.totalDurationMs += rec.durationMs;
      if (rec.status >= 400) s.errorCount++;
    }
    return summary;
  }

  /** Return circuit breaker stats for a service. */
  circuitBreakerStats(serviceId: string) {
    return this.breakers.get(serviceId)?.stats ?? null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _recordUsage(serviceId: string, req: ApiRequest, res: ApiResponse): void {
    this.usageLog.push({
      serviceId,
      method: req.method,
      path: req.path,
      status: res.status,
      durationMs: res.durationMs,
      timestamp: new Date().toISOString(),
    });
    if (this.usageLog.length > this.maxUsageRecords) {
      this.usageLog.shift();
    }
  }
}
