/**
 * Authorization middleware — V2-13.
 * Validates that an actor holds the required permissions before an action is executed.
 *
 * Permissions are modelled as a simple RBAC map: roles hold named permissions,
 * and actors are assigned one or more roles. Policies can optionally be registered
 * per-action for fine-grained attribute-based checks.
 */

import { ForbiddenError } from "../../core/src/errors/domain-errors.js";

/** A named permission string, e.g. "agent:execute", "memory:read" */
export type Permission = string;

/** Role definition — a named collection of permissions */
export interface RoleDefinition {
  name: string;
  permissions: Permission[];
}

/** Minimal actor descriptor needed for authorization checks */
export interface AuthorizationActor {
  id: string;
  roles: string[];
  /** Optional namespace for multi-tenant isolation */
  namespace?: string;
}

/** Context passed to policy functions for ABAC checks */
export interface PolicyContext {
  actor: AuthorizationActor;
  action: string;
  resource?: string;
  metadata?: Record<string, unknown>;
}

/** Policy function — returns true to grant, false/throws to deny */
export type PolicyFn = (ctx: PolicyContext) => boolean | Promise<boolean>;

export interface AuthorizationMiddlewareConfig {
  /** Role definitions */
  roles?: RoleDefinition[];
  /** Per-action ABAC policies (supplement RBAC checks) */
  policies?: Record<string, PolicyFn>;
  /** If true, deny by default when no matching role/policy is found. Default: true */
  denyByDefault?: boolean;
}

export interface AuthorizationResult {
  allowed: boolean;
  reason: string;
}

export class AuthorizationMiddleware {
  /** Map of role name → set of permissions */
  private readonly rolePermissions = new Map<string, Set<Permission>>();
  private readonly policies: Record<string, PolicyFn>;
  private readonly denyByDefault: boolean;

  constructor(config: AuthorizationMiddlewareConfig = {}) {
    for (const role of config.roles ?? []) {
      this.rolePermissions.set(role.name, new Set(role.permissions));
    }
    this.policies = config.policies ?? {};
    this.denyByDefault = config.denyByDefault ?? true;
  }

  /**
   * Add or update a role at runtime.
   */
  defineRole(role: RoleDefinition): void {
    this.rolePermissions.set(role.name, new Set(role.permissions));
  }

  /**
   * Register an ABAC policy for a specific action.
   */
  registerPolicy(action: string, policy: PolicyFn): void {
    this.policies[action] = policy;
  }

  /**
   * Check whether the actor is allowed to perform `action`.
   * Returns an `AuthorizationResult` without throwing.
   */
  async check(
    actor: AuthorizationActor,
    action: string,
    resource?: string,
    metadata?: Record<string, unknown>
  ): Promise<AuthorizationResult> {
    // RBAC: collect all permissions the actor holds via their roles
    const actorPermissions = this.collectPermissions(actor.roles);

    const hasPermission = actorPermissions.has(action) || actorPermissions.has("*");

    // ABAC: run action-specific policy if registered
    const policy = this.policies[action] ?? this.policies["*"];
    if (policy) {
      let policyResult = false;
      try {
        policyResult = await policy({ actor, action, resource, metadata });
      } catch {
        return { allowed: false, reason: `Policy for '${action}' threw an error` };
      }
      if (!policyResult) {
        return {
          allowed: false,
          reason: `Policy denied action '${action}' for actor '${actor.id}'`,
        };
      }
      if (hasPermission || !this.denyByDefault) {
        return { allowed: true, reason: "Policy and RBAC granted" };
      }
    }

    if (hasPermission) {
      return { allowed: true, reason: `Role permission granted for '${action}'` };
    }

    if (this.denyByDefault) {
      return {
        allowed: false,
        reason: `Actor '${actor.id}' lacks permission '${action}' (roles: ${actor.roles.join(", ") || "none"})`,
      };
    }

    return { allowed: true, reason: "Default allow" };
  }

  /**
   * Like `check` but throws `ForbiddenError` when access is denied.
   */
  async authorize(
    actor: AuthorizationActor,
    action: string,
    resource?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const result = await this.check(actor, action, resource, metadata);
    if (!result.allowed) {
      throw new ForbiddenError(result.reason);
    }
  }

  /**
   * Return the set of all permissions held by the given roles.
   */
  private collectPermissions(roles: string[]): Set<Permission> {
    const permissions = new Set<Permission>();
    for (const roleName of roles) {
      const rolePerm = this.rolePermissions.get(roleName);
      if (rolePerm) {
        for (const p of rolePerm) permissions.add(p);
      }
    }
    return permissions;
  }

  /**
   * List permissions available to an actor (union of all role permissions).
   */
  listActorPermissions(actor: AuthorizationActor): Permission[] {
    return Array.from(this.collectPermissions(actor.roles));
  }
}
