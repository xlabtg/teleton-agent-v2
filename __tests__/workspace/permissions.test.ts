import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { tempParent, teletonRoot, workspaceRoot } = vi.hoisted(() => {
  const { mkdtempSync } = require("fs") as typeof import("fs");
  const { tmpdir } = require("os") as typeof import("os");
  const { join } = require("path") as typeof import("path");
  const parent = mkdtempSync(join(tmpdir(), "teleton-permissions-test-"));
  const root = join(parent, ".teleton");
  return {
    tempParent: parent,
    teletonRoot: root,
    workspaceRoot: join(root, "workspace"),
  };
});

vi.mock("../../v1-src/workspace/paths.js", () => ({
  TELETON_ROOT: teletonRoot,
  WORKSPACE_ROOT: workspaceRoot,
  WORKSPACE_PATHS: {
    SOUL: join(workspaceRoot, "SOUL.md"),
    MEMORY: join(workspaceRoot, "MEMORY.md"),
    IDENTITY: join(workspaceRoot, "IDENTITY.md"),
    USER: join(workspaceRoot, "USER.md"),
    STRATEGY: join(workspaceRoot, "STRATEGY.md"),
    SECURITY: join(workspaceRoot, "SECURITY.md"),
    HEARTBEAT: join(workspaceRoot, "HEARTBEAT.md"),
    MEMORY_DIR: join(workspaceRoot, "memory"),
    DOWNLOADS_DIR: join(workspaceRoot, "downloads"),
    UPLOADS_DIR: join(workspaceRoot, "uploads"),
    TEMP_DIR: join(workspaceRoot, "temp"),
    MEMES_DIR: join(workspaceRoot, "memes"),
    PLUGINS_DIR: join(teletonRoot, "plugins"),
  },
}));

vi.mock("../../v1-src/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { ensureWorkspace } = await import("../../v1-src/workspace/manager.js");
const { hardenExistingPermissions } = await import("../../v1-src/workspace/harden-permissions.js");

function cleanTeletonRoot(): void {
  if (existsSync(teletonRoot)) {
    chmodSync(teletonRoot, 0o700);
    if (existsSync(workspaceRoot)) chmodSync(workspaceRoot, 0o700);
  }
  rmSync(teletonRoot, { recursive: true, force: true });
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("workspace directory permissions", () => {
  beforeEach(() => {
    cleanTeletonRoot();
  });

  afterAll(() => {
    cleanTeletonRoot();
    rmSync(tempParent, { recursive: true, force: true });
  });

  it("creates the Teleton root and workspace directories with mode 0700", async () => {
    await ensureWorkspace({ silent: true });

    expect(modeOf(teletonRoot)).toBe(0o700);
    expect(modeOf(workspaceRoot)).toBe(0o700);
  });

  it("hardens existing Teleton root and workspace directories to mode 0700", () => {
    mkdirSync(workspaceRoot, { recursive: true });
    chmodSync(teletonRoot, 0o755);
    chmodSync(workspaceRoot, 0o755);

    hardenExistingPermissions();

    expect(modeOf(teletonRoot)).toBe(0o700);
    expect(modeOf(workspaceRoot)).toBe(0o700);
  });
});
