import { describe, it, expect, beforeEach } from "vitest";
import { ScheduleStore } from "../../packages/intelligence/src/schedule-store.js";

const T = (iso: string) => new Date(iso);

describe("ScheduleStore", () => {
  let store: ScheduleStore;

  beforeEach(() => {
    store = new ScheduleStore();
  });

  it("should create and retrieve an entry", () => {
    const entry = store.create({
      userId: "u1",
      action: "Call Alice",
      triggerAt: T("2024-06-16T09:00:00Z"),
    });
    expect(entry.id).toBeTruthy();
    expect(entry.status).toBe("pending");
    expect(store.get(entry.id)).toEqual(entry);
  });

  it("should list pending entries for a user sorted by triggerAt", () => {
    store.create({ userId: "u1", action: "B", triggerAt: T("2024-06-17T00:00:00Z") });
    store.create({ userId: "u1", action: "A", triggerAt: T("2024-06-16T00:00:00Z") });
    const list = store.listForUser("u1");
    expect(list.map((e) => e.action)).toEqual(["A", "B"]);
  });

  it("should not list cancelled entries", () => {
    const e = store.create({ userId: "u1", action: "x", triggerAt: T("2024-06-16T00:00:00Z") });
    store.cancel(e.id);
    expect(store.listForUser("u1")).toHaveLength(0);
  });

  it("getDue() should return entries with triggerAt ≤ asOf", () => {
    const past = store.create({
      userId: "u1",
      action: "past",
      triggerAt: T("2024-06-14T00:00:00Z"),
    });
    const future = store.create({
      userId: "u1",
      action: "future",
      triggerAt: T("2024-06-20T00:00:00Z"),
    });
    const due = store.getDue(T("2024-06-15T12:00:00Z"));
    expect(due.map((e) => e.id)).toContain(past.id);
    expect(due.map((e) => e.id)).not.toContain(future.id);
  });

  it("getDue() should mark entries outside grace window as late", () => {
    const ancient = store.create({
      userId: "u1",
      action: "ancient",
      triggerAt: T("2024-01-01T00:00:00Z"), // far in the past
    });
    const due = store.getDue(T("2024-06-15T12:00:00Z"));
    const found = due.find((e) => e.id === ancient.id);
    expect(found?.status).toBe("late");
  });

  it("advance() should mark once entry as triggered", () => {
    const e = store.create({
      userId: "u1",
      action: "once",
      triggerAt: T("2024-06-15T10:00:00Z"),
      recurrence: { kind: "once" },
    });
    store.advance(e.id, T("2024-06-15T10:00:00Z"));
    expect(store.get(e.id)?.status).toBe("triggered");
  });

  it("advance() should update triggerAt for daily recurrence", () => {
    const e = store.create({
      userId: "u1",
      action: "daily",
      triggerAt: T("2024-06-15T08:00:00Z"),
      recurrence: { kind: "daily", intervalDays: 1 },
    });
    store.advance(e.id, T("2024-06-15T08:00:00Z"));
    const updated = store.get(e.id)!;
    expect(updated.status).toBe("pending");
    expect(updated.triggerAt.getUTCDate()).toBe(16); // next day
  });

  it("advance() should skip missed daily intervals and land after the fire time", () => {
    const e = store.create({
      userId: "u1",
      action: "daily",
      triggerAt: T("2024-06-01T08:00:00Z"),
      recurrence: { kind: "daily", intervalDays: 1 },
    });

    store.advance(e.id, T("2024-06-15T08:30:00Z"));

    const updated = store.get(e.id)!;
    expect(updated.status).toBe("pending");
    expect(updated.triggerAt.toISOString()).toBe("2024-06-16T08:00:00.000Z");
  });

  it("detectConflicts() should find overlapping entries within window", () => {
    store.create({
      userId: "u1",
      action: "existing",
      triggerAt: T("2024-06-16T09:00:00Z"),
    });
    const conflicts = store.detectConflicts({
      userId: "u1",
      action: "new",
      triggerAt: T("2024-06-16T09:02:00Z"), // 2 min overlap
    });
    expect(conflicts).toHaveLength(1);
  });

  it("detectConflicts() should not flag entries for different users", () => {
    store.create({ userId: "u1", action: "u1-entry", triggerAt: T("2024-06-16T09:00:00Z") });
    const conflicts = store.detectConflicts({
      userId: "u2",
      action: "u2-entry",
      triggerAt: T("2024-06-16T09:00:00Z"),
    });
    expect(conflicts).toHaveLength(0);
  });

  it("export/import round-trip preserves entries", () => {
    store.create({ userId: "u1", action: "Test", triggerAt: T("2024-06-16T09:00:00Z") });
    const snapshot = store.export();

    const store2 = new ScheduleStore();
    store2.import(snapshot);
    expect(store2.size).toBe(1);
    expect(store2.listForUser("u1")[0].action).toBe("Test");
  });

  it("should throw when maxEntriesPerUser is exceeded", () => {
    const small = new ScheduleStore({ maxEntriesPerUser: 2 });
    small.create({ userId: "u1", action: "a", triggerAt: T("2024-06-16T00:00:00Z") });
    small.create({ userId: "u1", action: "b", triggerAt: T("2024-06-17T00:00:00Z") });
    expect(() =>
      small.create({ userId: "u1", action: "c", triggerAt: T("2024-06-18T00:00:00Z") })
    ).toThrow();
  });

  it("delete() should permanently remove an entry", () => {
    const e = store.create({ userId: "u1", action: "del", triggerAt: T("2024-06-16T00:00:00Z") });
    store.delete(e.id);
    expect(store.get(e.id)).toBeUndefined();
  });
});
