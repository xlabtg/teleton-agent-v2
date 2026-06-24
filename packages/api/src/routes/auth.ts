/**
 * Authentication routes.
 * Provides login endpoint that returns a JWT-like token.
 */

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type BinaryLike,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";
import * as jose from "jose";
import { Hono } from "hono";
import { z } from "zod";
import type {
  AuthConfig,
  AuthUserRecord,
  AuthUserStore,
  TokenPayload,
  TokenType,
  UserRole,
} from "../middleware/auth.middleware.js";
import {
  generateCsrfToken,
  setCsrfCookie,
  type CsrfConfig,
} from "../middleware/csrf.middleware.js";

const LoginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1).max(2048),
});

const scryptAsync = promisify(scryptCallback) as (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options?: ScryptOptions
) => Promise<Buffer>;

const USER_ROLES: readonly UserRole[] = ["admin", "user", "plugin", "readonly"];
const TOKEN_TYPES: readonly TokenType[] = ["access", "refresh"];
const PASSWORD_HASH_ALGORITHM = "scrypt";
const PASSWORD_HASH_SEPARATOR = "$";
const DEFAULT_SCRYPT_PARAMS = {
  cost: 16_384,
  blockSize: 8,
  parallelization: 1,
  keyLength: 64,
  maxmem: 64 * 1024 * 1024,
} as const;
const DEVELOPMENT_PASSWORD_HASH =
  "scrypt$16384$8$1$64$dGVsZXRvbi1kZXYtYXV0aC1zYWx0LXYx$qK9wk4IvmtLGtc1zsU750-4gqiahByGRa1qtcCGH4_c-sSKDzn4Oc8rP0KWr__wKw94pd-UE3SQXxJgH05HgrA";
const DUMMY_PASSWORD_HASH =
  "scrypt$16384$8$1$64$dGVsZXRvbi1hdXRoLWR1bW15LXNhbHQtdjE$25opN0qr0Zx5t5y3vCaNKML7r5FJXGxYb1ZkVMRnRPteMN-RMBsbofeGf_I1TJ1lgiV_ygzQ7rDest5hnn4fjw";

interface ParsedPasswordHash {
  cost: number;
  blockSize: number;
  parallelization: number;
  keyLength: number;
  salt: Buffer;
  digest: Buffer;
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

function isTokenType(value: unknown): value is TokenType {
  return typeof value === "string" && TOKEN_TYPES.includes(value as TokenType);
}

function parsePositiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePasswordHash(passwordHash: string): ParsedPasswordHash | null {
  const parts = passwordHash.split(PASSWORD_HASH_SEPARATOR);
  if (parts.length !== 7) {
    return null;
  }

  const [algorithm, costRaw, blockSizeRaw, parallelizationRaw, keyLengthRaw, saltRaw, digestRaw] =
    parts;
  if (
    algorithm !== PASSWORD_HASH_ALGORITHM ||
    costRaw === undefined ||
    blockSizeRaw === undefined ||
    parallelizationRaw === undefined ||
    keyLengthRaw === undefined ||
    saltRaw === undefined ||
    digestRaw === undefined
  ) {
    return null;
  }

  const cost = parsePositiveInteger(costRaw);
  const blockSize = parsePositiveInteger(blockSizeRaw);
  const parallelization = parsePositiveInteger(parallelizationRaw);
  const keyLength = parsePositiveInteger(keyLengthRaw);
  if (!cost || !blockSize || !parallelization || !keyLength) {
    return null;
  }

  const salt = Buffer.from(saltRaw, "base64url");
  const digest = Buffer.from(digestRaw, "base64url");
  if (salt.length === 0 || digest.length !== keyLength) {
    return null;
  }

  return { cost, blockSize, parallelization, keyLength, salt, digest };
}

async function derivePasswordKey(
  password: string,
  salt: Buffer,
  params: Pick<ParsedPasswordHash, "cost" | "blockSize" | "parallelization" | "keyLength">
): Promise<Buffer> {
  return scryptAsync(password, salt, params.keyLength, {
    N: params.cost,
    r: params.blockSize,
    p: params.parallelization,
    maxmem: DEFAULT_SCRYPT_PARAMS.maxmem,
  });
}

export async function hashPassword(password: string, salt: Buffer | string = randomBytes(16)) {
  const saltBytes = typeof salt === "string" ? Buffer.from(salt, "utf8") : salt;
  const key = await derivePasswordKey(password, saltBytes, DEFAULT_SCRYPT_PARAMS);
  return [
    PASSWORD_HASH_ALGORITHM,
    DEFAULT_SCRYPT_PARAMS.cost,
    DEFAULT_SCRYPT_PARAMS.blockSize,
    DEFAULT_SCRYPT_PARAMS.parallelization,
    DEFAULT_SCRYPT_PARAMS.keyLength,
    saltBytes.toString("base64url"),
    key.toString("base64url"),
  ].join(PASSWORD_HASH_SEPARATOR);
}

export async function verifyPasswordHash(password: string, passwordHash: string): Promise<boolean> {
  const parsed = parsePasswordHash(passwordHash);
  if (!parsed) {
    return false;
  }

  try {
    const key = await derivePasswordKey(password, parsed.salt, parsed);
    return timingSafeEqual(key, parsed.digest);
  } catch {
    return false;
  }
}

export function createStaticUserStore(users: readonly AuthUserRecord[]): AuthUserStore {
  const usersByUsername = new Map(users.map((user) => [user.username, user]));
  return {
    findByUsername(username: string) {
      return usersByUsername.get(username) ?? null;
    },
  };
}

const DEVELOPMENT_USER_STORE = createStaticUserStore([
  {
    username: "admin",
    role: "admin",
    passwordHash: DEVELOPMENT_PASSWORD_HASH,
  },
]);

function getRuntimeEnv(config: AuthConfig): string {
  return config.runtimeEnv ?? process.env.NODE_ENV ?? "development";
}

function getUserStore(config: AuthConfig): AuthUserStore | null {
  if (config.userStore) {
    return config.userStore;
  }

  if (getRuntimeEnv(config) === "production") {
    return null;
  }

  return DEVELOPMENT_USER_STORE;
}

function parseTokenPayload(payload: jose.JWTPayload): TokenPayload | null {
  if (
    typeof payload.sub !== "string" ||
    !isUserRole(payload.role) ||
    !isTokenType(payload.type) ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  return {
    sub: payload.sub,
    role: payload.role,
    type: payload.type,
    iat: payload.iat,
    exp: payload.exp,
  };
}

/**
 * Creates a signed JWT using HMAC-SHA256.
 */
async function createToken(
  sub: string,
  role: UserRole,
  type: TokenType,
  secret: string,
  expirySeconds: number
): Promise<string> {
  const jwtSecret = new TextEncoder().encode(secret);
  const now = Math.floor(Date.now() / 1000);
  return new jose.SignJWT({ sub, role, type, iat: now })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(now + expirySeconds)
    .sign(jwtSecret);
}

export function createAuthRoutes(config: AuthConfig, csrfConfig: CsrfConfig = {}): Hono {
  const app = new Hono();

  /**
   * GET /api/auth/csrf-token
   * Issues a fresh CSRF token as a non-HttpOnly cookie (XSRF-TOKEN).
   * Browser clients must call this once after login and then echo the token
   * value in the X-CSRF-Token header on every state-changing request.
   * No authentication required — the token is tied to the browser session
   * via the cookie, not to a user identity.
   */
  app.get("/csrf-token", (ctx) => {
    const token = generateCsrfToken();
    setCsrfCookie(ctx, token, csrfConfig);
    return ctx.json({ csrfToken: token });
  });

  /**
   * POST /api/auth/login
   * Accepts username/password and returns a token after verifying a stored password hash.
   */
  app.post("/login", async (ctx) => {
    let rawBody: unknown;
    try {
      rawBody = await ctx.req.json();
    } catch {
      return ctx.json(
        { error: { code: "VALIDATION_ERROR", message: "Request body must be valid JSON" } },
        400
      );
    }

    const result = LoginSchema.safeParse(rawBody);
    if (!result.success) {
      return ctx.json(
        { error: { code: "VALIDATION_ERROR", message: "username and password are required" } },
        400
      );
    }

    const { username, password } = result.data;
    const userStore = getUserStore(config);
    if (!userStore) {
      return ctx.json(
        {
          error: {
            code: "AUTH_NOT_CONFIGURED",
            message: "Password authentication is not configured",
          },
        },
        501
      );
    }

    const user = await userStore.findByUsername(username);
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordMatches = await verifyPasswordHash(password, passwordHash);

    if (!user || user.disabled || !passwordMatches) {
      return ctx.json(
        {
          error: {
            code: "AUTHENTICATION_ERROR",
            message: "Invalid username or password",
          },
        },
        401
      );
    }

    const token = await createToken(
      user.username,
      user.role,
      "access",
      config.jwtSecret,
      config.tokenExpiry
    );
    const refreshToken = await createToken(
      user.username,
      user.role,
      "refresh",
      config.jwtSecret,
      config.refreshTokenExpiry
    );

    return ctx.json({
      token,
      refreshToken,
      expiresIn: config.tokenExpiry,
      tokenType: "Bearer",
    });
  });

  /**
   * GET /api/auth/me
   * Returns the current user info from the Bearer token.
   */
  app.get("/me", async (ctx) => {
    const authHeader = ctx.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return ctx.json(
        {
          error: {
            code: "AUTHENTICATION_ERROR",
            message: "Missing or invalid Authorization header",
          },
        },
        401
      );
    }

    const token = authHeader.slice(7);
    const jwtSecret = new TextEncoder().encode(config.jwtSecret);
    try {
      const { payload } = await jose.jwtVerify(token, jwtSecret, {
        algorithms: ["HS256", "HS384", "HS512"],
      });
      const tokenPayload = parseTokenPayload(payload);
      if (!tokenPayload || tokenPayload.type !== "access") {
        return ctx.json({ error: { code: "AUTHENTICATION_ERROR", message: "Invalid token" } }, 401);
      }
      const { sub, role, iat, exp } = tokenPayload;
      return ctx.json({ user: { sub, role, iat, exp } });
    } catch (error) {
      if (error instanceof jose.errors.JWTExpired) {
        return ctx.json({ error: { code: "AUTHENTICATION_ERROR", message: "Token expired" } }, 401);
      }
      return ctx.json({ error: { code: "AUTHENTICATION_ERROR", message: "Invalid token" } }, 401);
    }
  });

  /**
   * POST /api/auth/logout
   * Invalidates the current session on the client side.
   * Since tokens are stateless JWTs, the client must discard the token.
   * Logs the logout event for audit purposes.
   */
  app.post("/logout", (ctx) => {
    return ctx.json({ success: true, message: "Logged out. Discard your token on the client." });
  });

  /**
   * POST /api/auth/refresh
   * Accepts a refresh token and returns a new access token.
   */
  app.post("/refresh", async (ctx) => {
    let rawBody: unknown;
    try {
      rawBody = await ctx.req.json();
    } catch {
      return ctx.json(
        { error: { code: "VALIDATION_ERROR", message: "Request body must be valid JSON" } },
        400
      );
    }

    const result = RefreshSchema.safeParse(rawBody);
    if (!result.success) {
      return ctx.json(
        { error: { code: "VALIDATION_ERROR", message: "refreshToken is required" } },
        400
      );
    }

    const { refreshToken } = result.data;
    const jwtSecret = new TextEncoder().encode(config.jwtSecret);
    try {
      const { payload } = await jose.jwtVerify(refreshToken, jwtSecret, {
        algorithms: ["HS256", "HS384", "HS512"],
      });
      const tokenPayload = parseTokenPayload(payload);
      if (!tokenPayload || tokenPayload.type !== "refresh") {
        return ctx.json(
          { error: { code: "AUTHENTICATION_ERROR", message: "Invalid refresh token" } },
          401
        );
      }
      const newToken = await createToken(
        tokenPayload.sub,
        tokenPayload.role,
        "access",
        config.jwtSecret,
        config.tokenExpiry
      );

      return ctx.json({
        token: newToken,
        expiresIn: config.tokenExpiry,
        tokenType: "Bearer",
      });
    } catch (error) {
      if (error instanceof jose.errors.JWTExpired) {
        return ctx.json(
          { error: { code: "AUTHENTICATION_ERROR", message: "Refresh token expired" } },
          401
        );
      }
      return ctx.json(
        { error: { code: "AUTHENTICATION_ERROR", message: "Invalid refresh token" } },
        401
      );
    }
  });

  return app;
}
