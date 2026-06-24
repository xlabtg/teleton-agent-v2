import { describe, it, expect } from "vitest";
import { AuthorizationMiddleware } from "../../packages/security/src/authorization-middleware.js";
import { ForbiddenError } from "../../packages/core/src/errors/domain-errors.js";
import type { AuthorizationActor } from "../../packages/security/src/authorization-middleware.js";

const ADMIN: AuthorizationActor = { id: "admin-1", roles: ["admin"] };
const VIEWER: AuthorizationActor = { id: "user-1", roles: ["viewer"] };
const GUEST: AuthorizationActor = { id: "guest-1", roles: [] };

describe("AuthorizationMiddleware", () => {
  it("grants access when actor holds required permission", async () => {
    const auth = new AuthorizationMiddleware({
      roles: [{ name: "admin", permissions: ["agent:execute", "memory:write"] }],
    });
    const result = await auth.check(ADMIN, "agent:execute");
    expect(result.allowed).toBe(true);
  });

  it("denies access when actor lacks permission", async () => {
    const auth = new AuthorizationMiddleware({
      roles: [{ name: "viewer", permissions: ["memory:read"] }],
    });
    const result = await auth.check(VIEWER, "agent:execute");
    expect(result.allowed).toBe(false);
  });

  it("denies by default when actor has no roles", async () => {
    const auth = new AuthorizationMiddleware({
      roles: [{ name: "admin", permissions: ["*"] }],
    });
    const result = await auth.check(GUEST, "anything");
    expect(result.allowed).toBe(false);
  });

  it("wildcard permission '*' grants all actions", async () => {
    const auth = new AuthorizationMiddleware({
      roles: [{ name: "admin", permissions: ["*"] }],
    });
    const result = await auth.check(ADMIN, "any.arbitrary.action");
    expect(result.allowed).toBe(true);
  });

  it("hierarchical wildcard permissions grant matching child actions", async () => {
    const auth = new AuthorizationMiddleware({
      roles: [{ name: "admin", permissions: ["agent:*", "memory:read:*"] }],
    });

    await expect(auth.check(ADMIN, "agent:execute")).resolves.toMatchObject({ allowed: true });
    await expect(auth.check(ADMIN, "agent:tools:run")).resolves.toMatchObject({ allowed: true });
    await expect(auth.check(ADMIN, "memory:read:private")).resolves.toMatchObject({
      allowed: true,
    });
    await expect(auth.check(ADMIN, "memory:write")).resolves.toMatchObject({ allowed: false });
  });

  it("authorize() throws ForbiddenError on denial", async () => {
    const auth = new AuthorizationMiddleware({ roles: [] });
    await expect(auth.authorize(GUEST, "secret:read")).rejects.toThrow(ForbiddenError);
  });

  it("authorize() resolves without throwing on grant", async () => {
    const auth = new AuthorizationMiddleware({
      roles: [{ name: "admin", permissions: ["secret:read"] }],
    });
    await expect(auth.authorize(ADMIN, "secret:read")).resolves.toBeUndefined();
  });

  it("ABAC policy can deny even with RBAC permission", async () => {
    const auth = new AuthorizationMiddleware({
      roles: [{ name: "admin", permissions: ["agent:execute"] }],
      policies: {
        "agent:execute": (ctx) => ctx.actor.namespace === "prod",
      },
    });
    const adminNoNs: AuthorizationActor = { id: "a", roles: ["admin"] };
    const result = await auth.check(adminNoNs, "agent:execute");
    expect(result.allowed).toBe(false);
  });

  it("ABAC policy can grant when RBAC lacks permission and denyByDefault=false", async () => {
    const auth = new AuthorizationMiddleware({
      roles: [],
      denyByDefault: false,
      policies: {
        "special:action": () => true,
      },
    });
    const result = await auth.check(GUEST, "special:action");
    expect(result.allowed).toBe(true);
  });

  it("does not fail open on policy denial when denyByDefault=false", async () => {
    const auth = new AuthorizationMiddleware({
      roles: [{ name: "admin", permissions: ["agent:*"] }],
      denyByDefault: false,
      policies: {
        "agent:execute": () => false,
      },
    });

    const result = await auth.check(ADMIN, "agent:execute");
    expect(result.allowed).toBe(false);
  });

  it("defineRole adds a role at runtime", async () => {
    const auth = new AuthorizationMiddleware({ roles: [] });
    auth.defineRole({ name: "editor", permissions: ["doc:edit"] });
    const editor: AuthorizationActor = { id: "e-1", roles: ["editor"] };
    const result = await auth.check(editor, "doc:edit");
    expect(result.allowed).toBe(true);
  });

  it("listActorPermissions returns union of all role permissions", () => {
    const auth = new AuthorizationMiddleware({
      roles: [
        { name: "viewer", permissions: ["memory:read"] },
        { name: "editor", permissions: ["memory:read", "memory:write"] },
      ],
    });
    const multi: AuthorizationActor = { id: "u", roles: ["viewer", "editor"] };
    const perms = auth.listActorPermissions(multi);
    expect(perms).toContain("memory:read");
    expect(perms).toContain("memory:write");
  });
});
