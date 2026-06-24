// src/workspace/validator.ts

import { existsSync, lstatSync, readdirSync, realpathSync } from "fs";
import { resolve, normalize, relative, extname, basename, dirname, isAbsolute, sep } from "path";
import { homedir } from "os";
import { WORKSPACE_ROOT, ALLOWED_EXTENSIONS, MAX_FILE_SIZES } from "./paths.js";
import { MAX_FILENAME_LENGTH } from "../constants/limits.js";

/**
 * Security error for path validation failures
 */
export class WorkspaceSecurityError extends Error {
  constructor(
    message: string,
    public readonly attemptedPath: string
  ) {
    super(message);
    this.name = "WorkspaceSecurityError";
  }
}

/**
 * Recursively decode URL-encoded string until stable
 * Prevents double/triple encoding bypass attacks (%252e%252e → %2e%2e → ..)
 * OWASP best practice for path validation
 */
function decodeRecursive(str: string): string {
  let decoded = str;
  let prev = "";
  let iterations = 0;
  const maxIterations = 10; // Prevent infinite loop on malformed input

  while (decoded !== prev && iterations < maxIterations) {
    prev = decoded;
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      break; // Invalid encoding, stop here
    }
    iterations++;
  }

  return decoded;
}

function assertInsideWorkspace(realPath: string, inputPath: string): string {
  const realWorkspaceRoot = realpathSync(WORKSPACE_ROOT);
  const realRelativePath = relative(realWorkspaceRoot, realPath);

  if (
    realRelativePath === ".." ||
    realRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(realRelativePath)
  ) {
    throw new WorkspaceSecurityError(
      `Access denied: Path '${inputPath}' is outside the workspace. ` +
        `Only files in ~/.teleton/workspace/ are accessible.`,
      inputPath
    );
  }

  return realRelativePath;
}

function nearestExistingAncestor(path: string): string | null {
  let current = path;

  while (!existsSync(current)) {
    const parent = dirname(current);

    if (parent === current) {
      return null;
    }

    current = parent;
  }

  return current;
}

/**
 * Result of path validation
 */
export interface ValidatedPath {
  /** Absolute resolved path (safe) */
  absolutePath: string;
  /** Path relative to workspace root */
  relativePath: string;
  /** Whether the file/directory exists */
  exists: boolean;
  /** Whether it's a directory */
  isDirectory: boolean;
  /** File extension (lowercase) */
  extension: string;
  /** File name without path */
  filename: string;
}

/**
 * Validate and resolve a path within the workspace
 *
 * SECURITY: This is the ONLY function that should be used to validate paths
 * before any file operation. It prevents:
 * - Path traversal attacks (../)
 * - Symlink attacks
 * - Access to protected files
 * - Access outside workspace
 * - URL-encoded traversal (%2e%2e)
 *
 * @param inputPath - User-provided path (can be relative or absolute)
 * @param allowCreate - Allow paths that don't exist yet (for writes)
 * @returns Validated path information
 * @throws WorkspaceSecurityError if path is invalid or outside workspace
 */
export function validatePath(inputPath: string, allowCreate: boolean = false): ValidatedPath {
  // FIX: Reject empty paths
  if (!inputPath || inputPath.trim() === "") {
    throw new WorkspaceSecurityError("Path cannot be empty.", inputPath);
  }

  // FIX: Trim whitespace and normalize backslashes
  const trimmedPath = inputPath.trim().replace(/\\/g, "/");

  // SECURITY FIX: Recursively decode URL-encoded characters to prevent
  // double-encoding bypass attacks (%252e%252e → %2e%2e → ..)
  const decodedPath = decodeRecursive(trimmedPath);

  // Normalize and resolve the path
  let absolutePath: string;

  // Handle different input formats
  if (decodedPath.startsWith("/")) {
    // Absolute path - must be within workspace
    absolutePath = resolve(normalize(decodedPath));
  } else if (decodedPath.startsWith("~/")) {
    // SECURITY FIX: Allow home-relative paths but validate they're in workspace
    const expanded = decodedPath.replace(/^~(?=$|[\\/])/, homedir());
    absolutePath = resolve(expanded);
  } else {
    // Relative path - assume relative to workspace root
    absolutePath = resolve(WORKSPACE_ROOT, normalize(decodedPath));
  }

  // CRITICAL: Ensure the lexical path is within workspace before touching disk.
  const relativePath = relative(WORKSPACE_ROOT, absolutePath);

  // Check for path traversal (../)
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new WorkspaceSecurityError(
      `Access denied: Path '${inputPath}' is outside the workspace. ` +
        `Only files in ~/.teleton/workspace/ are accessible.`,
      inputPath
    );
  }

  // Check if path exists
  const exists = existsSync(absolutePath);

  if (!exists && !allowCreate) {
    throw new WorkspaceSecurityError(
      `File not found: '${inputPath}' does not exist in workspace.`,
      inputPath
    );
  }

  if (exists) {
    const realAbsolutePath = realpathSync(absolutePath);
    assertInsideWorkspace(realAbsolutePath, inputPath);

    // SECURITY FIX: Use lstatSync() instead of statSync() to detect symlinks
    // (statSync follows symlinks, lstatSync does not)
    const stats = lstatSync(absolutePath);

    if (stats.isSymbolicLink()) {
      throw new WorkspaceSecurityError(
        `Access denied: Symbolic links are not allowed for security reasons.`,
        inputPath
      );
    }
  } else {
    const existingAncestor = nearestExistingAncestor(absolutePath);

    if (!existingAncestor) {
      throw new WorkspaceSecurityError(
        `Access denied: Path '${inputPath}' is outside the workspace. ` +
          `Only files in ~/.teleton/workspace/ are accessible.`,
        inputPath
      );
    }

    assertInsideWorkspace(realpathSync(existingAncestor), inputPath);
  }

  return {
    absolutePath,
    relativePath,
    exists,
    isDirectory: exists ? lstatSync(absolutePath).isDirectory() : false,
    extension: extname(absolutePath).toLowerCase(),
    filename: basename(absolutePath),
  };
}

/**
 * Validate a path for reading
 */
export function validateReadPath(inputPath: string): ValidatedPath {
  const validated = validatePath(inputPath, false);

  if (validated.isDirectory) {
    throw new WorkspaceSecurityError(`Cannot read directory as file: '${inputPath}'`, inputPath);
  }

  return validated;
}

/**
 * Validate a path for writing
 * Extension whitelist is now OPTIONAL (fix from audit)
 */
// Owner configuration files that cannot be overwritten by the agent
const IMMUTABLE_FILES = ["SOUL.md", "STRATEGY.md", "SECURITY.md"];

export function validateWritePath(
  inputPath: string,
  fileType?: keyof typeof ALLOWED_EXTENSIONS
): ValidatedPath {
  const validated = validatePath(inputPath, true);

  // SECURITY: Block writes to owner-only configuration files
  if (IMMUTABLE_FILES.includes(validated.filename)) {
    throw new WorkspaceSecurityError(
      `Cannot write to ${validated.filename}. This file is configured by the owner. Use memory_write instead.`,
      inputPath
    );
  }

  // Check extension if type specified (OPTIONAL - not enforced by default)
  if (fileType && ALLOWED_EXTENSIONS[fileType]) {
    const allowedExts = ALLOWED_EXTENSIONS[fileType] as readonly string[];
    if (!allowedExts.includes(validated.extension)) {
      throw new WorkspaceSecurityError(
        `Invalid file type: '${validated.extension}' is not allowed for ${fileType}. ` +
          `Allowed: ${allowedExts.join(", ")}`,
        inputPath
      );
    }
  }

  return validated;
}

/**
 * Validate a directory path exists or can be created
 */
export function validateDirectory(inputPath: string): ValidatedPath {
  const validated = validatePath(inputPath, true);

  if (validated.exists && !validated.isDirectory) {
    throw new WorkspaceSecurityError(
      `Path exists but is not a directory: '${inputPath}'`,
      inputPath
    );
  }

  return validated;
}

/**
 * Check if a path is within the workspace (quick check without full validation)
 */
export function isWithinWorkspace(inputPath: string): boolean {
  try {
    validatePath(inputPath, true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a safe filename (remove dangerous characters)
 */
export function sanitizeFilename(filename: string): string {
  // Remove path separators and dangerous characters
  return filename
    .replace(/[/\\]/g, "_")
    .replace(/\.\./g, "_")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/[\x00-\x1f]/g, "")
    .slice(0, MAX_FILENAME_LENGTH);
}

/**
 * Check file size against limits
 */
export function validateFileSize(path: string, type: keyof typeof MAX_FILE_SIZES): void {
  const stats = lstatSync(path);
  const maxSize = MAX_FILE_SIZES[type];

  if (stats.size > maxSize) {
    throw new WorkspaceSecurityError(
      `File too large: ${stats.size} bytes exceeds ${type} limit of ${maxSize} bytes`,
      path
    );
  }
}

/**
 * List files in a workspace directory
 */
export function listWorkspaceDirectory(subpath: string = ""): string[] {
  const validated = validateDirectory(subpath || WORKSPACE_ROOT);

  if (!validated.exists) {
    return [];
  }

  return readdirSync(validated.absolutePath);
}
