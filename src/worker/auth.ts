import type { AppUser, Role } from "./domain";
import { fail } from "./json";

const ROLE_RANK: Record<Role, number> = {
  member: 1,
  editor: 2,
  reviewer: 3,
  admin: 4,
};

export function hasRole(user: AppUser, role: Role): boolean {
  return ROLE_RANK[user.role] >= ROLE_RANK[role];
}

export function requireRole(user: AppUser, role: Role): void {
  if (!hasRole(user, role)) {
    fail(403, `${role} role is required`);
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split(".");
  if (!payload) return null;
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return JSON.parse(atob(normalized)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

const SESSION_COOKIE = "graduate_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string): Promise<string> {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export async function derivePasswordHash(password: string, salt: string, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBytes = decodeBase64Url(salt);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: saltBytes.buffer as ArrayBuffer, iterations },
      key,
      256,
    ),
  );
}

export async function verifyPassword(password: string, hash: string, salt: string, iterations: number): Promise<boolean> {
  const actual = await derivePasswordHash(password, salt, iterations);
  const expected = decodeBase64Url(hash);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
  };
  return actual.byteLength === expected.byteLength && subtle.timingSafeEqual(actual, expected);
}

export async function authenticateRequest(db: D1Database, request: Request, env: Env): Promise<AppUser> {
  if (env.APP_ENV === "local" && env.MOCK_AUTH_EMAIL) {
    return getCurrentUser(db, env.MOCK_AUTH_EMAIL);
  }

  const sessionToken = cookieValue(request, SESSION_COOKIE);
  if (sessionToken) {
    const tokenHash = await sha256(sessionToken);
    const user = await db
      .prepare(
        `SELECT u.id, u.display_name, u.email, u.department, u.role, u.status
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.status = 'active'`,
      )
      .bind(tokenHash)
      .first<AppUser>();
    if (user) {
      await db.prepare("UPDATE user_sessions SET last_seen_at = datetime('now') WHERE token_hash = ?").bind(tokenHash).run();
      return user;
    }
  }

  return getCurrentUser(db, resolveRequestEmail(request, env));
}

export async function loginWithPassword(
  db: D1Database,
  email: string,
  password: string,
  request: Request,
): Promise<{ user: AppUser; cookie: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const credential = await db
    .prepare(
      `SELECT u.id, u.display_name, u.email, u.department, u.role, u.status,
              c.password_hash, c.password_salt, c.password_iterations, c.failed_attempts, c.locked_until
       FROM users u JOIN user_credentials c ON c.user_id = u.id
       WHERE lower(u.email) = ?`,
    )
    .bind(normalizedEmail)
    .first<AppUser & {
      password_hash: string;
      password_salt: string;
      password_iterations: number;
      failed_attempts: number;
      locked_until: string | null;
    }>();

  if (credential?.locked_until && new Date(`${credential.locked_until}Z`) > new Date()) {
    fail(429, "ログイン試行が多すぎます。15分後にもう一度お試しください。");
  }

  const valid = credential
    ? await verifyPassword(password, credential.password_hash, credential.password_salt, credential.password_iterations)
    : false;
  if (!credential || !valid || credential.status !== "active") {
    if (credential) {
      const failedAttempts = credential.failed_attempts + 1;
      await db
        .prepare(
          `UPDATE user_credentials SET failed_attempts = ?, locked_until = CASE WHEN ? >= 5 THEN datetime('now', '+15 minutes') ELSE NULL END
           WHERE user_id = ?`,
        )
        .bind(failedAttempts, failedAttempts, credential.id)
        .run();
    }
    fail(401, "メールアドレスまたはパスワードが違います。");
  }

  const token = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await db.batch([
    db.prepare("UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?").bind(credential.id),
    db
      .prepare(
        `INSERT INTO user_sessions (token_hash, user_id, expires_at, user_agent, ip_address)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        tokenHash,
        credential.id,
        expiresAt,
        request.headers.get("User-Agent")?.slice(0, 300) ?? null,
        request.headers.get("CF-Connecting-IP") ?? null,
      ),
  ]);

  const { password_hash: _hash, password_salt: _salt, password_iterations: _iterations, failed_attempts: _failed, locked_until: _locked, ...user } = credential;
  return {
    user,
    cookie: `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
  };
}

export async function logoutSession(db: D1Database, request: Request): Promise<string> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await db.prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function resolveRequestEmail(request: Request, env: Env): string {
  if (env.APP_ENV === "local" && env.MOCK_AUTH_EMAIL) {
    return env.MOCK_AUTH_EMAIL;
  }

  const accessEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (accessEmail) {
    return accessEmail;
  }

  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (assertion) {
    const payload = decodeJwtPayload(assertion);
    const email = payload?.email;
    if (typeof email === "string" && email.includes("@")) {
      return email;
    }
  }

  const previewEnv = env as Env & { PREVIEW_AUTH_TOKEN?: string; PREVIEW_AUTH_EMAIL?: string };
  const previewToken = cookieValue(request, "graduate_preview_token");
  if (previewEnv.PREVIEW_AUTH_TOKEN && previewToken && previewToken === previewEnv.PREVIEW_AUTH_TOKEN) {
    return previewEnv.PREVIEW_AUTH_EMAIL ?? "admin@example.com";
  }

  fail(401, "Authentication required");
}

export async function getCurrentUser(db: D1Database, email: string): Promise<AppUser> {
  const user = await db
    .prepare("SELECT id, display_name, email, department, role, status FROM users WHERE email = ?")
    .bind(email)
    .first<AppUser>();

  if (!user || user.status !== "active") {
    fail(403, "User is not registered or active");
  }

  return user;
}
