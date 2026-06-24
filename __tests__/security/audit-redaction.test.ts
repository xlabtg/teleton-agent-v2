import { describe, it, expect } from "vitest";
import {
  redactSensitiveFields,
  DEFAULT_SENSITIVE_KEYS,
  createAuditEvent,
} from "../../packages/security/src/audit-event.js";
import type { AuditEvent } from "../../packages/security/src/audit-event.js";

function makeEvent(metadata: Record<string, unknown>): AuditEvent {
  return createAuditEvent({
    category: "agent_action",
    action: "test.action",
    outcome: "success",
    severity: "info",
    actor: { type: "agent", id: "agent-1" },
    metadata,
  }) as AuditEvent;
}

describe("redactSensitiveFields", () => {
  it("redacts keys matching DEFAULT_SENSITIVE_KEYS", () => {
    const event = makeEvent({
      password: "s3cr3t",
      secret: "my-secret",
      token: "abc123",
      key: "api-key-value",
      credential: "cred-data",
      authorization: "Bearer xyz",
      private: "private-key",
      session: "session-data",
      mnemonic: "word1 word2 word3",
      phone: "+1234567890",
      ssn: "123-45-6789",
      credit_card: "4111111111111111",
      cvv: "123",
      pin: "9999",
      safeField: "should-not-be-redacted",
    });

    const result = redactSensitiveFields(event);

    expect(result.metadata!["password"]).toBe("[REDACTED]");
    expect(result.metadata!["secret"]).toBe("[REDACTED]");
    expect(result.metadata!["token"]).toBe("[REDACTED]");
    expect(result.metadata!["key"]).toBe("[REDACTED]");
    expect(result.metadata!["credential"]).toBe("[REDACTED]");
    expect(result.metadata!["authorization"]).toBe("[REDACTED]");
    expect(result.metadata!["private"]).toBe("[REDACTED]");
    expect(result.metadata!["session"]).toBe("[REDACTED]");
    expect(result.metadata!["mnemonic"]).toBe("[REDACTED]");
    expect(result.metadata!["phone"]).toBe("[REDACTED]");
    expect(result.metadata!["ssn"]).toBe("[REDACTED]");
    expect(result.metadata!["credit_card"]).toBe("[REDACTED]");
    expect(result.metadata!["cvv"]).toBe("[REDACTED]");
    expect(result.metadata!["pin"]).toBe("[REDACTED]");
    expect(result.metadata!["safeField"]).toBe("should-not-be-redacted");
  });

  it("redacts keys that contain a sensitive fragment (case-insensitive substring match)", () => {
    const event = makeEvent({
      apiKey: "key-123",
      api_key: "key-456",
      accessToken: "tok-789",
      refreshToken: "tok-abc",
      botToken: "bot-tok",
      privateKey: "priv-key",
      sessionString: "session-data",
    });

    const result = redactSensitiveFields(event, DEFAULT_SENSITIVE_KEYS);

    expect(result.metadata!["apiKey"]).toBe("[REDACTED]");
    expect(result.metadata!["api_key"]).toBe("[REDACTED]");
    expect(result.metadata!["accessToken"]).toBe("[REDACTED]");
    expect(result.metadata!["refreshToken"]).toBe("[REDACTED]");
    expect(result.metadata!["botToken"]).toBe("[REDACTED]");
    expect(result.metadata!["privateKey"]).toBe("[REDACTED]");
    expect(result.metadata!["sessionString"]).toBe("[REDACTED]");
  });

  it("passes through events without metadata unchanged", () => {
    const event = makeEvent({});
    const noMetaEvent = { ...event, metadata: undefined };
    const result = redactSensitiveFields(noMetaEvent);
    expect(result.metadata).toBeUndefined();
  });

  it("returns original non-metadata fields intact", () => {
    const event = makeEvent({ token: "secret" });
    const result = redactSensitiveFields(event);
    expect(result.action).toBe(event.action);
    expect(result.actor).toEqual(event.actor);
    expect(result.outcome).toBe(event.outcome);
  });

  it("redacts session, mnemonic, and phone by default", () => {
    const event = makeEvent({
      session: "session-data",
      sessionString: "1BVtsOJ...",
      mnemonic: "word1 word2 word3",
      phone: "+1234567890",
    });

    const result = redactSensitiveFields(event);

    expect(result.metadata!["session"]).toBe("[REDACTED]");
    expect(result.metadata!["sessionString"]).toBe("[REDACTED]");
    expect(result.metadata!["mnemonic"]).toBe("[REDACTED]");
    expect(result.metadata!["phone"]).toBe("[REDACTED]");
  });

  it("supports additional custom sensitive keys beyond defaults", () => {
    const event = makeEvent({
      nationalId: "12345678",
      passport: "AB1234567",
    });

    const customKeys = [...DEFAULT_SENSITIVE_KEYS, "nationalId", "passport"];
    const result = redactSensitiveFields(event, customKeys);

    expect(result.metadata!["nationalId"]).toBe("[REDACTED]");
    expect(result.metadata!["passport"]).toBe("[REDACTED]");
  });

  it("recursively redacts sensitive keys in nested objects", () => {
    const event = makeEvent({
      request: {
        headers: {
          authorization: "Bearer nested-token",
        },
      },
      user: {
        profile: {
          password: "nested-password",
          displayName: "Alice",
        },
      },
    });

    const result = redactSensitiveFields(event);

    expect(result.metadata).toEqual({
      request: {
        headers: {
          authorization: "[REDACTED]",
        },
      },
      user: {
        profile: {
          password: "[REDACTED]",
          displayName: "Alice",
        },
      },
    });
  });

  it("recursively redacts sensitive keys inside arrays", () => {
    const event = makeEvent({
      attempts: [
        { token: "array-token", status: "blocked" },
        { nested: { mnemonic: "word1 word2 word3" } },
      ],
    });

    const result = redactSensitiveFields(event);

    expect(result.metadata).toEqual({
      attempts: [
        { token: "[REDACTED]", status: "blocked" },
        { nested: { mnemonic: "[REDACTED]" } },
      ],
    });
  });

  it("deep-clones retained nested metadata values", () => {
    const metadata = {
      request: {
        headers: {
          contentType: "application/json",
        },
      },
    };
    const event = makeEvent(metadata);

    const result = redactSensitiveFields(event);
    metadata.request.headers.contentType = "text/plain";

    expect(result.metadata).toEqual({
      request: {
        headers: {
          contentType: "application/json",
        },
      },
    });
  });
});
