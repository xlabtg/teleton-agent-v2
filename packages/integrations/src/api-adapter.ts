/**
 * API Adapter — V2-15.
 * Defines the universal adapter interface and per-service adapter implementations
 * that normalize external API calls into a consistent request/response shape.
 */

// ---------------------------------------------------------------------------
// Core request/response types
// ---------------------------------------------------------------------------

export interface ApiRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface ApiResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  body: T;
  durationMs: number;
}

export interface AdapterMeta {
  /** Unique service identifier, e.g. "openai", "telegram". */
  serviceId: string;
  /** Human-readable display name. */
  displayName: string;
  /** Base URL for all requests through this adapter. */
  baseUrl: string;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * Universal adapter interface that all service-specific adapters must implement.
 * Adapters are independently testable: swap out `execute` with a mock backend.
 */
export interface ApiAdapter<TCredential = unknown> {
  readonly meta: AdapterMeta;

  /**
   * Execute a normalised request against the backing service.
   * The adapter is responsible for injecting authentication headers,
   * translating errors to domain errors, and normalising responses.
   */
  execute<T = unknown>(request: ApiRequest, credential: TCredential): Promise<ApiResponse<T>>;

  /**
   * Validate that a credential is structurally correct before use.
   * Does not make a network call.
   */
  validateCredential(credential: TCredential): boolean;
}

// ---------------------------------------------------------------------------
// HTTP fetch-based base adapter
// ---------------------------------------------------------------------------

export interface HttpAdapterConfig {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  defaultTimeoutMs?: number;
}

/**
 * Base adapter that delegates to the global `fetch` API.
 * Subclass this to build concrete service adapters.
 *
 * @example
 * class OpenAiAdapter extends HttpBaseAdapter<{ apiKey: string }> {
 *   readonly meta = { serviceId: "openai", displayName: "OpenAI", baseUrl: "https://api.openai.com" };
 *   validateCredential(c) { return typeof c.apiKey === "string" && c.apiKey.length > 0; }
 *   protected buildAuthHeaders(c) { return { Authorization: `Bearer ${c.apiKey}` }; }
 * }
 */
export abstract class HttpBaseAdapter<TCredential = unknown>
  implements ApiAdapter<TCredential>
{
  abstract readonly meta: AdapterMeta;

  protected readonly defaultHeaders: Record<string, string>;
  protected readonly defaultTimeoutMs: number;

  constructor(config: HttpAdapterConfig) {
    this.defaultHeaders = config.defaultHeaders ?? {};
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 30_000;
  }

  /** Return authentication headers derived from the credential. */
  protected abstract buildAuthHeaders(credential: TCredential): Record<string, string>;

  abstract validateCredential(credential: TCredential): boolean;

  async execute<T = unknown>(
    request: ApiRequest,
    credential: TCredential
  ): Promise<ApiResponse<T>> {
    const url = buildUrl(this.meta.baseUrl, request.path, request.query);
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.defaultHeaders,
      ...this.buildAuthHeaders(credential),
      ...(request.headers ?? {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const start = Date.now();
    try {
      const response = await fetch(url, {
        method: request.method,
        headers,
        body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
        signal: controller.signal,
      });

      const durationMs = Date.now() - start;
      const responseHeaders = headersToRecord(response.headers);
      const body = await parseResponseBody<T>(response);

      return { status: response.status, headers: responseHeaders, body, durationMs };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string>
): string {
  const base = baseUrl.replace(/\/$/, "");
  const normalPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${base}${normalPath}`;
  if (!query || Object.keys(query).length === 0) return url;
  const params = new URLSearchParams(query);
  return `${url}?${params.toString()}`;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function parseResponseBody<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return (await response.text()) as unknown as T;
}
