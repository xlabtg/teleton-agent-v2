import { describe, it, expect, beforeEach } from "vitest";
import { AuditStore } from "../../packages/security/src/audit-store.js";
import { AuditQuery } from "../../packages/security/src/audit-query.js";
import { createAuditEvent } from "../../packages/security/src/audit-event.js";
import type { AuditEvent } from "../../packages/security/src/audit-event.js";

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return createAuditEvent({
    category: "agent_action",
    action: "agent.run",
    outcome: "success",
    severity: "info",
    actor: { type: "user", id: "user-1" },
    ...overrides,
  }) as AuditEvent;
}

describe("AuditQuery", () => {
  let store: AuditStore;
  let query: AuditQuery;

  beforeEach(async () => {
    store = new AuditStore();
    query = new AuditQuery(store);
    await store.append(
      makeEvent({
        action: "login",
        category: "authentication",
        actor: { type: "user", id: "alice" },
      })
    );
    await store.append(
      makeEvent({
        action: "data.read",
        category: "data_access",
        actor: { type: "agent", id: "bot-1" },
      })
    );
    await store.append(
      makeEvent({
        action: "login.fail",
        category: "authentication",
        outcome: "failure",
        severity: "error",
        actor: { type: "user", id: "alice" },
      })
    );
  });

  it("returns all events when no filter applied", () => {
    const result = query.query();
    expect(result.total).toBe(3);
    expect(result.events).toHaveLength(3);
  });

  it("filters by actorId", () => {
    const result = query.query({ actorId: "alice" });
    expect(result.total).toBe(2);
    expect(result.events.every((e) => e.actor.id === "alice")).toBe(true);
  });

  it("filters by category", () => {
    const result = query.query({ category: "data_access" });
    expect(result.total).toBe(1);
    expect(result.events[0].action).toBe("data.read");
  });

  it("filters by outcome", () => {
    const result = query.query({ outcome: "failure" });
    expect(result.total).toBe(1);
    expect(result.events[0].action).toBe("login.fail");
  });

  it("filters by minSeverity", () => {
    const result = query.query({ minSeverity: "error" });
    expect(result.total).toBe(1);
    expect(result.events[0].severity).toBe("error");
  });

  it("paginates correctly", () => {
    const page1 = query.query({}, { offset: 0, limit: 2 });
    expect(page1.events).toHaveLength(2);
    expect(page1.total).toBe(3);

    const page2 = query.query({}, { offset: 2, limit: 2 });
    expect(page2.events).toHaveLength(1);
  });

  it("exportJson returns newline-delimited JSON", () => {
    const json = query.exportJson();
    const lines = json.split("\n");
    expect(lines).toHaveLength(3);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it("exportCef returns CEF-formatted lines", () => {
    const cef = query.exportCef();
    const lines = cef.split("\n");
    expect(lines[0]).toMatch(/^CEF:0\|Teleton\|SecurityAudit\|/);
  });
});
