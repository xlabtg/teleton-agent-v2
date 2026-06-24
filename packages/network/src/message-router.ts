/**
 * Message Router — V2-21.
 * Routes AgentMessages across a network of agents, supporting:
 *  - Direct delivery (source → destination).
 *  - Explicit multi-hop routing via the `routing.via` waypoint list.
 *  - Automatic next-hop resolution through a pluggable RouteTable.
 *  - TTL enforcement to prevent routing loops.
 *  - Partial-failure handling (unreachable agents, timeouts).
 */

import { type AgentMessage, type RouteHop, createProtocolErrorMessage } from "./message-schema.js";
import { ProtocolErrorCode, DEFAULT_NAMESPACE, MAX_TTL } from "./protocol.js";

// ─── Transport abstraction ────────────────────────────────────────────────────

/**
 * Minimal interface the router uses to hand off a message to a specific agent.
 * Implementations may use HTTP, WebSockets, in-process queues, etc.
 */
export interface AgentTransport {
  /**
   * Deliver a message to the named agent.
   * Resolves when the message has been accepted (not necessarily processed).
   * Rejects with a TransportError on failure.
   */
  send(agentId: string, message: AgentMessage): Promise<void>;
}

export class TransportError extends Error {
  constructor(
    message: string,
    public readonly agentId: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "TransportError";
  }
}

// ─── Route table ─────────────────────────────────────────────────────────────

/**
 * A route entry describes how to reach a destination agent.
 */
export interface RouteEntry {
  /** Destination agent id. */
  destination: string;
  /**
   * Next-hop agent id. When equal to `destination` the route is direct.
   * When different, the message is forwarded to the next hop first.
   */
  nextHop: string;
  /** Cost metric (lower is better). Used for tie-breaking. */
  metric: number;
  /** Namespace this entry belongs to. */
  namespace: string;
}

/**
 * In-memory route table. Agents register their reachability here.
 * A real implementation would sync routes over the network.
 */
export class RouteTable {
  private readonly routes = new Map<string, RouteEntry[]>();

  /**
   * Add or update a route entry. Multiple entries per destination are
   * supported; the router will pick the lowest-metric one.
   */
  addRoute(entry: RouteEntry): void {
    const key = routeKey(entry.destination, entry.namespace);
    const existing = this.routes.get(key) ?? [];
    // Replace entry with the same nextHop if present; otherwise append.
    const idx = existing.findIndex((e) => e.nextHop === entry.nextHop);
    if (idx >= 0) {
      existing[idx] = entry;
    } else {
      existing.push(entry);
    }
    this.routes.set(key, existing);
  }

  /** Remove all routes to a destination in a given namespace. */
  removeRoutes(destination: string, namespace = DEFAULT_NAMESPACE): void {
    this.routes.delete(routeKey(destination, namespace));
  }

  /**
   * Resolve the best next-hop for a destination.
   * Returns undefined when no route is found.
   */
  resolve(destination: string, namespace = DEFAULT_NAMESPACE): RouteEntry | undefined {
    const entries = this.routes.get(routeKey(destination, namespace));
    if (!entries || entries.length === 0) return undefined;
    return entries.reduce((best, e) => (e.metric < best.metric ? e : best));
  }

  /** List all known destinations in a namespace. */
  listDestinations(namespace = DEFAULT_NAMESPACE): string[] {
    return Array.from(this.routes.keys())
      .filter((k) => k.endsWith(`:${namespace}`))
      .map((k) => k.split(":")[0]);
  }
}

function routeKey(destination: string, namespace: string): string {
  return `${destination}:${namespace}`;
}

// ─── Routing result ───────────────────────────────────────────────────────────

export type RoutingOutcome = "delivered" | "dropped_ttl" | "no_route" | "transport_error";

export interface RoutingResult {
  outcome: RoutingOutcome;
  /** The next-hop agent the message was forwarded to (when delivered). */
  deliveredTo?: string;
  /** Human-readable reason for non-delivery. */
  reason?: string;
  /** The error protocol message generated on failure, if applicable. */
  errorMessage?: AgentMessage;
}

// ─── MessageRouter ────────────────────────────────────────────────────────────

export interface MessageRouterConfig {
  /** Local agent id. */
  agentId: string;
  /** Transport used to forward messages. */
  transport: AgentTransport;
  /** Route table for next-hop resolution. */
  routeTable: RouteTable;
  /** Default namespace. */
  namespace?: string;
  /**
   * Whether to emit a protocol error message back to the source when routing
   * fails. Default: true.
   */
  emitErrorOnFailure?: boolean;
}

/**
 * Routes messages on behalf of the local agent.
 *
 * For each inbound message the router:
 *  1. Validates the TTL.
 *  2. Appends a hop record to routing.path.
 *  3. Determines the next hop (explicit via list or route table lookup).
 *  4. Delivers the message via the transport.
 *  5. Returns a RoutingResult describing what happened.
 *
 * For outbound messages (source === localAgentId) the same pipeline applies.
 */
export class MessageRouter {
  private readonly agentId: string;
  private readonly transport: AgentTransport;
  private readonly routeTable: RouteTable;
  private readonly namespace: string;
  private readonly emitErrorOnFailure: boolean;

  constructor(config: MessageRouterConfig) {
    this.agentId = config.agentId;
    this.transport = config.transport;
    this.routeTable = config.routeTable;
    this.namespace = config.namespace ?? DEFAULT_NAMESPACE;
    this.emitErrorOnFailure = config.emitErrorOnFailure ?? true;
  }

  /**
   * Route a message. Call this for both inbound (received from another agent)
   * and outbound (locally generated) messages.
   */
  async route(message: AgentMessage): Promise<RoutingResult> {
    // ── 1. TTL check ──────────────────────────────────────────────────────────
    if (message.routing.ttl <= 0) {
      return this.fail(
        message,
        "dropped_ttl",
        ProtocolErrorCode.TTL_EXPIRED,
        "Message TTL expired"
      );
    }
    if (message.routing.ttl > MAX_TTL) {
      return this.fail(
        message,
        "dropped_ttl",
        ProtocolErrorCode.TTL_EXPIRED,
        `Message TTL ${message.routing.ttl} exceeds maximum ${MAX_TTL}`
      );
    }
    if (message.routing.path.some((hop) => hop.agentId === this.agentId)) {
      return this.fail(
        message,
        "dropped_ttl",
        ProtocolErrorCode.TTL_EXPIRED,
        `Routing loop detected at "${this.agentId}"`
      );
    }

    // ── 2. Record this hop ────────────────────────────────────────────────────
    const hop: RouteHop = { agentId: this.agentId, timestamp: new Date().toISOString() };
    const forwardMsg: AgentMessage = {
      ...message,
      routing: {
        ...message.routing,
        ttl: message.routing.ttl - 1,
        path: [...message.routing.path, hop],
      },
    };

    // ── 3. Are we the destination? ────────────────────────────────────────────
    if (message.routing.destination === this.agentId) {
      // Message has arrived; caller should process it locally.
      return { outcome: "delivered", deliveredTo: this.agentId };
    }

    // ── 4. Determine next hop ─────────────────────────────────────────────────
    const nextHop = this.resolveNextHop(forwardMsg);
    if (!nextHop) {
      return this.fail(
        forwardMsg,
        "no_route",
        ProtocolErrorCode.NO_ROUTE,
        `No route to "${forwardMsg.routing.destination}"`
      );
    }

    // ── 5. Forward ────────────────────────────────────────────────────────────
    const finalMsg: AgentMessage = {
      ...forwardMsg,
      routing: { ...forwardMsg.routing, via: this.remainingVia(forwardMsg, nextHop) },
    };

    try {
      await this.transport.send(nextHop, finalMsg);
      return { outcome: "delivered", deliveredTo: nextHop };
    } catch (err) {
      return this.fail(
        finalMsg,
        "transport_error",
        ProtocolErrorCode.REQUEST_TIMEOUT,
        `Transport error forwarding to "${nextHop}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private resolveNextHop(msg: AgentMessage): string | undefined {
    // If an explicit waypoint list is present, use the first entry.
    if (msg.routing.via.length > 0) {
      return msg.routing.via[0];
    }

    // Fall back to route table.
    const ns = msg.routing.namespace ?? this.namespace;
    const entry = this.routeTable.resolve(msg.routing.destination, ns);
    return entry?.nextHop;
  }

  /** Returns the remaining via list after consuming `usedHop`. */
  private remainingVia(msg: AgentMessage, usedHop: string): string[] {
    if (msg.routing.via.length > 0 && msg.routing.via[0] === usedHop) {
      return msg.routing.via.slice(1);
    }
    return msg.routing.via;
  }

  private async fail(
    msg: AgentMessage,
    outcome: RoutingOutcome,
    code: string,
    reason: string
  ): Promise<RoutingResult> {
    let errorMessage: AgentMessage | undefined;

    if (this.emitErrorOnFailure && msg.routing.source !== this.agentId) {
      errorMessage = createProtocolErrorMessage({
        source: this.agentId,
        destination: msg.routing.source,
        namespace: msg.routing.namespace,
        code,
        message: reason,
        offendingMessageId: msg.headers.messageId,
      });

      // Best-effort delivery of the error back to the source; ignore failures.
      await this.transport.send(msg.routing.source, errorMessage).catch(() => undefined);
    }

    return { outcome, reason, errorMessage };
  }
}
