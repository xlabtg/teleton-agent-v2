/**
 * Handshake — V2-21.
 * Implements the protocol handshake sequence used to establish a trusted,
 * version-negotiated session between two agents before they exchange
 * application messages.
 *
 * Sequence:
 *   Initiator                      Responder
 *   ─────────                      ─────────
 *   HELLO ─────────────────────►
 *         ◄───────────────────── HELLO_ACK
 *   CONFIRM ───────────────────►
 *         ◄───────────────────── CONFIRM_ACK  (session established)
 *
 * If any step fails the responder sends REJECT and the session is aborted.
 */

import { randomUUID } from "node:crypto";
import {
  SUPPORTED_VERSIONS,
  negotiateVersion,
  ProtocolErrorCode,
  DEFAULT_NAMESPACE,
} from "./protocol.js";

// ─── Handshake message sub-types ─────────────────────────────────────────────

export type HandshakeStep = "HELLO" | "HELLO_ACK" | "CONFIRM" | "CONFIRM_ACK" | "REJECT";

/**
 * Payload carried inside an AgentMessage whose headers.type === "handshake".
 */
export interface HandshakePayload {
  /** Which step in the handshake sequence this message represents. */
  step: HandshakeStep;
  /** Protocol versions the sender supports (only in HELLO / HELLO_ACK). */
  supportedVersions?: string[];
  /** The negotiated version both sides agreed on (only in CONFIRM / CONFIRM_ACK). */
  negotiatedVersion?: string;
  /** Capabilities the sender advertises (name → description). */
  capabilities?: Record<string, string>;
  /** Rejection reason (only in REJECT). */
  reason?: string;
  /** Error code (only in REJECT). */
  errorCode?: string;
  /** Opaque nonce for replay-protection. */
  nonce?: string;
  /** Echo of the peer nonce from the previous step. */
  echoNonce?: string;
  /** Sender public key or token for mutual authentication (base64). */
  senderPublicKey?: string;
  /** Trusted anchor proof (e.g. signed nonce), base64. */
  trustProof?: string;
}

// ─── Session ──────────────────────────────────────────────────────────────────

export type SessionStatus =
  | "pending"
  | "hello_sent"
  | "hello_acked"
  | "confirmed"
  | "rejected"
  | "expired";

/**
 * An established (or in-progress) session between two agents.
 */
export interface AgentSession {
  /** Unique session identifier. */
  sessionId: string;
  /** Agent id of the initiating side. */
  initiatorId: string;
  /** Agent id of the responding side. */
  responderId: string;
  /** Agreed-upon protocol version. Populated after CONFIRM_ACK. */
  protocolVersion: string | null;
  /** Capabilities advertised by the responder. */
  responderCapabilities: Record<string, string>;
  /** Current handshake phase. */
  status: SessionStatus;
  /** Time the session was created. */
  createdAt: Date;
  /** Time the session last transitioned. */
  updatedAt: Date;
  /** Namespace this session belongs to. */
  namespace: string;
  /** Nonce issued by this agent and expected to be echoed by the peer. */
  issuedNonce?: string;
  /** Peer nonce this agent must echo in the next handshake step. */
  expectedPeerNonce?: string;
}

// ─── Handshake errors ─────────────────────────────────────────────────────────

export class HandshakeError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "HandshakeError";
  }
}

// ─── HandshakeManager ────────────────────────────────────────────────────────

export interface HandshakeManagerConfig {
  /**
   * Local agent id.
   */
  agentId: string;
  /**
   * Capabilities this agent exposes to peers (name → description).
   */
  capabilities?: Record<string, string>;
  /**
   * Protocol versions this agent supports.
   * Defaults to SUPPORTED_VERSIONS.
   */
  supportedVersions?: string[];
  /**
   * Milliseconds before an in-progress session is considered expired.
   * Default: 30 000.
   */
  sessionTimeoutMs?: number;
  /**
   * Namespace. Default: "default".
   */
  namespace?: string;
}

/**
 * Manages the handshake lifecycle for one local agent.
 *
 * Usage (initiator side):
 *   const hm = new HandshakeManager({ agentId: "agent-a" });
 *   const hello = hm.initiateHandshake("agent-b");        // → HELLO payload
 *   // … send hello over the wire …
 *   // … receive HELLO_ACK payload from agent-b …
 *   const confirm = hm.handleHelloAck(sessionId, ack);    // → CONFIRM payload
 *   // … send confirm …
 *   // … receive CONFIRM_ACK …
 *   hm.handleConfirmAck(sessionId, confirmAck);
 *   const session = hm.getSession(sessionId);             // status: "confirmed"
 *
 * Usage (responder side):
 *   const hm = new HandshakeManager({ agentId: "agent-b" });
 *   const ack = hm.handleHello(hello);                    // → HELLO_ACK payload
 *   // … send ack …
 *   // … receive CONFIRM …
 *   const confirmAck = hm.handleConfirm(sessionId, confirm); // → CONFIRM_ACK
 */
export class HandshakeManager {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly consumedInboundNonces = new Map<string, number>();
  private readonly agentId: string;
  private readonly capabilities: Record<string, string>;
  private readonly supportedVersions: string[];
  private readonly sessionTimeoutMs: number;
  private readonly namespace: string;

  constructor(config: HandshakeManagerConfig) {
    this.agentId = config.agentId;
    this.capabilities = config.capabilities ?? {};
    this.supportedVersions = config.supportedVersions ?? [...SUPPORTED_VERSIONS];
    this.sessionTimeoutMs = config.sessionTimeoutMs ?? 30_000;
    this.namespace = config.namespace ?? DEFAULT_NAMESPACE;
  }

  // ── Initiator side ─────────────────────────────────────────────────────────

  /**
   * Start a new handshake with a remote agent.
   * Returns the HELLO payload the caller should transmit.
   * Also returns the newly created sessionId so the caller can track it.
   */
  initiateHandshake(remoteAgentId: string): { sessionId: string; payload: HandshakePayload } {
    const sessionId = `${this.agentId}:${remoteAgentId}:${Date.now()}`;
    const now = new Date();
    const nonce = this.generateNonce();

    const session: AgentSession = {
      sessionId,
      initiatorId: this.agentId,
      responderId: remoteAgentId,
      protocolVersion: null,
      responderCapabilities: {},
      status: "hello_sent",
      createdAt: now,
      updatedAt: now,
      namespace: this.namespace,
      issuedNonce: nonce,
    };

    this.sessions.set(sessionId, session);

    return {
      sessionId,
      payload: {
        step: "HELLO",
        supportedVersions: [...this.supportedVersions],
        capabilities: { ...this.capabilities },
        nonce,
      },
    };
  }

  /**
   * Process a HELLO_ACK received from the responder.
   * Returns the CONFIRM payload to send back.
   */
  handleHelloAck(sessionId: string, ack: HandshakePayload): HandshakePayload {
    const session = this.requireSession(sessionId, "hello_sent");

    if (ack.step === "REJECT") {
      session.status = "rejected";
      session.updatedAt = new Date();
      throw new HandshakeError(
        ack.reason ?? "Handshake rejected by remote",
        ack.errorCode ?? ProtocolErrorCode.HANDSHAKE_REJECTED
      );
    }

    if (ack.step !== "HELLO_ACK") {
      throw new HandshakeError(
        `Expected HELLO_ACK, got ${ack.step}`,
        ProtocolErrorCode.MALFORMED_MESSAGE
      );
    }
    this.consumeExpectedNonce(ack.echoNonce, session.issuedNonce, "HELLO_ACK");

    const remoteVersions = ack.supportedVersions ?? [];
    const agreed = negotiateVersion(this.supportedVersions, remoteVersions);
    if (!agreed) {
      session.status = "rejected";
      throw new HandshakeError(
        `No common protocol version. Local: ${this.supportedVersions.join(",")} Remote: ${remoteVersions.join(",")}`,
        ProtocolErrorCode.VERSION_MISMATCH
      );
    }

    session.protocolVersion = agreed;
    session.responderCapabilities = ack.capabilities ?? {};
    session.expectedPeerNonce = ack.nonce;
    session.status = "hello_acked";
    session.updatedAt = new Date();

    return {
      step: "CONFIRM",
      negotiatedVersion: agreed,
      capabilities: { ...this.capabilities },
      nonce: session.expectedPeerNonce,
      echoNonce: session.expectedPeerNonce,
    };
  }

  /**
   * Process the final CONFIRM_ACK from the responder.
   * After this call getSession(sessionId).status === "confirmed".
   */
  handleConfirmAck(sessionId: string, confirmAck: HandshakePayload): void {
    const session = this.requireSession(sessionId, "hello_acked");

    if (confirmAck.step === "REJECT") {
      session.status = "rejected";
      session.updatedAt = new Date();
      throw new HandshakeError(
        confirmAck.reason ?? "Confirm rejected by remote",
        confirmAck.errorCode ?? ProtocolErrorCode.HANDSHAKE_REJECTED
      );
    }

    if (confirmAck.step !== "CONFIRM_ACK") {
      throw new HandshakeError(
        `Expected CONFIRM_ACK, got ${confirmAck.step}`,
        ProtocolErrorCode.MALFORMED_MESSAGE
      );
    }
    if (confirmAck.nonce) {
      this.markInboundNonceConsumed(confirmAck.nonce);
    }

    session.status = "confirmed";
    session.updatedAt = new Date();
  }

  // ── Responder side ──────────────────────────────────────────────────────────

  /**
   * Process an incoming HELLO from the initiator.
   * Creates a new session and returns the HELLO_ACK payload (or REJECT).
   */
  handleHello(
    hello: HandshakePayload,
    initiatorId: string
  ): { sessionId: string; payload: HandshakePayload } {
    this.consumeRequiredInboundNonce(hello.nonce, "HELLO");

    const remoteVersions = hello.supportedVersions ?? [];
    const agreed = negotiateVersion(this.supportedVersions, remoteVersions);

    const sessionId = `${initiatorId}:${this.agentId}:${Date.now()}`;
    const now = new Date();

    if (!agreed) {
      const session: AgentSession = {
        sessionId,
        initiatorId,
        responderId: this.agentId,
        protocolVersion: null,
        responderCapabilities: {},
        status: "rejected",
        createdAt: now,
        updatedAt: now,
        namespace: this.namespace,
      };
      this.sessions.set(sessionId, session);

      return {
        sessionId,
        payload: {
          step: "REJECT",
          reason: `No common protocol version. Remote: ${remoteVersions.join(",")} Local: ${this.supportedVersions.join(",")}`,
          errorCode: ProtocolErrorCode.VERSION_MISMATCH,
        },
      };
    }

    const nonce = this.generateNonce();
    const session: AgentSession = {
      sessionId,
      initiatorId,
      responderId: this.agentId,
      protocolVersion: agreed,
      responderCapabilities: { ...this.capabilities },
      status: "hello_acked",
      createdAt: now,
      updatedAt: now,
      namespace: this.namespace,
      issuedNonce: nonce,
      expectedPeerNonce: hello.nonce,
    };
    this.sessions.set(sessionId, session);

    return {
      sessionId,
      payload: {
        step: "HELLO_ACK",
        supportedVersions: [...this.supportedVersions],
        capabilities: { ...this.capabilities },
        nonce,
        echoNonce: hello.nonce,
      },
    };
  }

  /**
   * Process the CONFIRM message from the initiator.
   * Returns CONFIRM_ACK to complete the handshake.
   */
  handleConfirm(sessionId: string, confirm: HandshakePayload): HandshakePayload {
    const session = this.requireSession(sessionId, "hello_acked");

    if (confirm.step !== "CONFIRM") {
      throw new HandshakeError(
        `Expected CONFIRM, got ${confirm.step}`,
        ProtocolErrorCode.MALFORMED_MESSAGE
      );
    }
    this.consumeExpectedNonce(confirm.echoNonce ?? confirm.nonce, session.issuedNonce, "CONFIRM");

    // Verify the negotiated version matches what we agreed on
    if (confirm.negotiatedVersion && confirm.negotiatedVersion !== session.protocolVersion) {
      session.status = "rejected";
      session.updatedAt = new Date();
      return {
        step: "REJECT",
        reason: `Version mismatch in CONFIRM: expected ${session.protocolVersion} got ${confirm.negotiatedVersion}`,
        errorCode: ProtocolErrorCode.VERSION_MISMATCH,
      };
    }

    session.status = "confirmed";
    session.updatedAt = new Date();
    return { step: "CONFIRM_ACK", negotiatedVersion: session.protocolVersion ?? undefined };
  }

  // ── Session management ──────────────────────────────────────────────────────

  /** Retrieve a session by id. Returns undefined if not found. */
  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Return all sessions in a given status. */
  listSessions(status?: SessionStatus): AgentSession[] {
    const all = Array.from(this.sessions.values());
    if (!status) return all;
    return all.filter((s) => s.status === status);
  }

  /** Remove expired pending/in-progress sessions. Returns the count removed. */
  purgeExpired(): number {
    const cutoff = Date.now() - this.sessionTimeoutMs;
    let removed = 0;
    for (const [id, session] of this.sessions) {
      const isTerminal = session.status === "confirmed" || session.status === "rejected";
      if (!isTerminal && session.updatedAt.getTime() < cutoff) {
        session.status = "expired";
        session.updatedAt = new Date();
        this.sessions.delete(id);
        removed++;
      }
    }
    this.purgeConsumedNonces(cutoff);
    return removed;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private generateNonce(): string {
    return randomUUID();
  }

  private consumeRequiredInboundNonce(nonce: string | undefined, step: HandshakeStep): void {
    if (!nonce) {
      throw new HandshakeError(
        `${step} is missing required nonce`,
        ProtocolErrorCode.MALFORMED_MESSAGE
      );
    }
    this.markInboundNonceConsumed(nonce);
  }

  private consumeExpectedNonce(
    received: string | undefined,
    expected: string | undefined,
    step: HandshakeStep
  ): void {
    if (!expected || !received || received !== expected) {
      throw new HandshakeError(`${step} nonce mismatch`, ProtocolErrorCode.MALFORMED_MESSAGE);
    }
    this.markInboundNonceConsumed(received);
  }

  private markInboundNonceConsumed(nonce: string): void {
    const cutoff = Date.now() - this.sessionTimeoutMs;
    this.purgeConsumedNonces(cutoff);

    const consumedAt = this.consumedInboundNonces.get(nonce);
    if (consumedAt !== undefined && consumedAt >= cutoff) {
      throw new HandshakeError(
        "Handshake nonce replay detected",
        ProtocolErrorCode.MALFORMED_MESSAGE
      );
    }
    this.consumedInboundNonces.set(nonce, Date.now());
  }

  private purgeConsumedNonces(cutoff: number): void {
    for (const [nonce, consumedAt] of this.consumedInboundNonces) {
      if (consumedAt < cutoff) {
        this.consumedInboundNonces.delete(nonce);
      }
    }
  }

  private requireSession(sessionId: string, expectedStatus: SessionStatus): AgentSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new HandshakeError(
        `Session "${sessionId}" not found`,
        ProtocolErrorCode.MALFORMED_MESSAGE
      );
    }
    if (session.status !== expectedStatus) {
      throw new HandshakeError(
        `Session "${sessionId}" is in status "${session.status}", expected "${expectedStatus}"`,
        ProtocolErrorCode.MALFORMED_MESSAGE
      );
    }
    return session;
  }
}
