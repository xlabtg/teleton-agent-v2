/**
 * Protocol — V2-21.
 * Defines protocol-level constants, version parsing, negotiation logic, and
 * graceful degradation helpers. All agents participating in the cross-agent
 * network use these utilities to agree on a common protocol version at
 * connection time.
 */

import { PROTOCOL_VERSION } from "./message-schema.js";

// ─── Version utilities ────────────────────────────────────────────────────────

/** Parsed semantic version with major, minor, and patch components. */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse a "major.minor.patch" string.
 * Returns null when the string does not conform.
 */
export function parseSemVer(version: string): SemVer | null {
  const parts = version.split(".");
  if (parts.length !== 3) return null;
  const [major, minor, patch] = parts.map(Number);
  if ([major, minor, patch].some((n) => !Number.isInteger(n) || n < 0)) return null;
  return { major, minor, patch };
}

/**
 * Compare two SemVer objects.
 * Returns  1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

// ─── Compatibility rules ──────────────────────────────────────────────────────

/**
 * Determine whether a message with `messagePV` is compatible with the
 * local agent running `localPV`.
 *
 * Compatibility rules (aligned with SemVer 2.0):
 *  - Same major version AND messagePV.minor <= localPV.minor  → compatible
 *  - Different major version                                   → incompatible
 *  - messagePV.minor > localPV.minor                          → forward-compatible
 *    (the local agent should still attempt processing but may ignore unknown fields)
 */
export type CompatibilityResult = "compatible" | "incompatible" | "forward-compatible";

export function checkCompatibility(localPV: SemVer, messagePV: SemVer): CompatibilityResult {
  if (localPV.major !== messagePV.major) return "incompatible";
  if (messagePV.minor > localPV.minor) return "forward-compatible";
  return "compatible";
}

// ─── Negotiation ─────────────────────────────────────────────────────────────

/**
 * Given two sets of supported versions, choose the highest version that both
 * sides support. Returns null when there is no common version.
 *
 * The negotiation algorithm:
 *  1. Parse and validate all version strings from both lists.
 *  2. Build the intersection (versions present in both sets).
 *  3. Return the highest version in the intersection.
 */
export function negotiateVersion(local: string[], remote: string[]): string | null {
  const remoteSet = new Set(remote);
  const common = local.filter((v) => remoteSet.has(v));

  if (common.length === 0) return null;

  // Sort descending and pick the highest
  const parsed = common
    .map((v) => ({ raw: v, parsed: parseSemVer(v) }))
    .filter((e): e is { raw: string; parsed: SemVer } => e.parsed !== null);

  if (parsed.length === 0) return null;

  parsed.sort((a, b) => compareSemVer(b.parsed, a.parsed));
  return parsed[0].raw;
}

// ─── Protocol error codes ─────────────────────────────────────────────────────

/**
 * Canonical error codes sent in ProtocolErrorMessage payloads.
 * Application-level errors use their own code namespaces.
 */
export const ProtocolErrorCode = {
  /** Sender and receiver share no common protocol version. */
  VERSION_MISMATCH: "PROTOCOL_VERSION_MISMATCH",
  /** Message format could not be parsed. */
  MALFORMED_MESSAGE: "PROTOCOL_MALFORMED_MESSAGE",
  /** A required header field is missing or invalid. */
  INVALID_HEADER: "PROTOCOL_INVALID_HEADER",
  /** The message signature failed verification. */
  SIGNATURE_INVALID: "PROTOCOL_SIGNATURE_INVALID",
  /** No route to the destination agent. */
  NO_ROUTE: "PROTOCOL_NO_ROUTE",
  /** Message TTL expired during routing. */
  TTL_EXPIRED: "PROTOCOL_TTL_EXPIRED",
  /** Destination agent does not support the requested capability. */
  CAPABILITY_UNSUPPORTED: "PROTOCOL_CAPABILITY_UNSUPPORTED",
  /** Handshake was rejected by the remote agent. */
  HANDSHAKE_REJECTED: "PROTOCOL_HANDSHAKE_REJECTED",
  /** Request timed out waiting for a response. */
  REQUEST_TIMEOUT: "PROTOCOL_REQUEST_TIMEOUT",
} as const;

export type ProtocolErrorCodeValue = (typeof ProtocolErrorCode)[keyof typeof ProtocolErrorCode];

// ─── Protocol constants ───────────────────────────────────────────────────────

/** The current local protocol version string. */
export { PROTOCOL_VERSION };

/**
 * All protocol versions supported by this implementation.
 * When a new version is released, prepend it to this list.
 */
export const SUPPORTED_VERSIONS: string[] = ["1.0.0"];

/** Default message TTL (max hops before the message is dropped). */
export const DEFAULT_TTL = 10;

/** Maximum allowed TTL. Routers MUST reject messages with ttl > MAX_TTL. */
export const MAX_TTL = 32;

/** Default namespace used when none is specified. */
export const DEFAULT_NAMESPACE = "default";

// ─── Header validation ────────────────────────────────────────────────────────

/**
 * Lightweight structural validation for an incoming message's headers.
 * Returns a list of human-readable error strings; empty means valid.
 */
export function validateHeaders(headers: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!headers.messageId || typeof headers.messageId !== "string") {
    errors.push("headers.messageId must be a non-empty string");
  }

  const validTypes = new Set(["request", "response", "event", "handshake", "error"]);
  if (!headers.type || !validTypes.has(headers.type as string)) {
    errors.push(`headers.type must be one of: ${[...validTypes].join(", ")}`);
  }

  if (!headers.protocolVersion || typeof headers.protocolVersion !== "string") {
    errors.push("headers.protocolVersion must be a non-empty string");
  } else if (!parseSemVer(headers.protocolVersion as string)) {
    errors.push(`headers.protocolVersion "${headers.protocolVersion}" is not a valid semver`);
  }

  if (!headers.createdAt || typeof headers.createdAt !== "string") {
    errors.push("headers.createdAt must be a non-empty ISO-8601 string");
  } else if (Number.isNaN(Date.parse(headers.createdAt as string))) {
    errors.push(`headers.createdAt "${headers.createdAt}" is not a valid date`);
  }

  if (headers.metadata !== undefined && typeof headers.metadata !== "object") {
    errors.push("headers.metadata must be an object when present");
  }

  return errors;
}
