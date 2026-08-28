import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash, verify } from "argon2";
import type Database from "better-sqlite3";
import { SESSION_COOKIE } from "./config.ts";

const SESSION_DAYS = 365;
const SESSION_TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const developmentOwnerPromises = new WeakMap<Database.Database, Promise<string>>();
export const MIN_PASSWORD_LENGTH = 8;

export function normalizeUsername(username: string): string {
  return username.trim().normalize("NFKC").toLocaleLowerCase("it-IT");
}

function displayUsername(username: string): string {
  return username.trim().normalize("NFKC");
}

function assertCredentialPolicy(username: string, password: string): void {
  const storedUsername = displayUsername(username);
  if (storedUsername.length === 0 || storedUsername.length > 64)
    throw new Error("USERNAME_INVALID");
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 128)
    throw new Error("PASSWORD_INVALID");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function clientKeyHash(clientKey: string): string {
  return createHash("sha256").update(clientKey).digest("hex");
}

function recordFailedAttempt(
  database: Database.Database,
  storedClientKey: string,
  now: Date,
): void {
  const update = database.transaction(() => {
    const latest = database
      .prepare("SELECT failed_count FROM login_attempts WHERE client_key = ?")
      .get(storedClientKey) as { failed_count: number } | undefined;
    const failedCount = (latest?.failed_count ?? 0) + 1;
    const delaySeconds = failedCount < 3 ? 0 : Math.min(60, 2 ** (failedCount - 3));
    const blockedUntil = delaySeconds
      ? new Date(now.getTime() + delaySeconds * 1_000).toISOString()
      : null;
    database
      .prepare(
        `INSERT INTO login_attempts(client_key, failed_count, blocked_until, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(client_key) DO UPDATE SET
           failed_count = excluded.failed_count,
           blocked_until = excluded.blocked_until,
           updated_at = excluded.updated_at`,
      )
      .run(storedClientKey, failedCount, blockedUntil, now.toISOString());
  });
  update.immediate();
}

export function hasOwner(database: Database.Database): boolean {
  return getOwnerId(database) !== null;
}

function getOwnerId(database: Database.Database): string | null {
  const owner = database.prepare("SELECT id FROM owner LIMIT 1").get() as
    | { id: string }
    | undefined;
  return owner?.id ?? null;
}

export function getOwnerUsername(database: Database.Database, ownerId: string): string {
  const owner = database.prepare("SELECT username FROM owner WHERE id = ?").get(ownerId) as
    | { username: string }
    | undefined;
  if (!owner) throw new Error("OWNER_NOT_FOUND");
  return owner.username;
}

export async function createOwner(
  database: Database.Database,
  username: string,
  password: string,
): Promise<string> {
  assertCredentialPolicy(username, password);
  const ownerId = randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hash(password, { type: 2 });
  const storedUsername = displayUsername(username);
  const normalizedUsername = normalizeUsername(username);
  const create = database.transaction(() => {
    if (hasOwner(database)) throw new Error("OWNER_EXISTS");
    database
      .prepare(
        `INSERT INTO owner(
           id, username, username_normalized, password_hash, created_at, password_changed_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(ownerId, storedUsername, normalizedUsername, passwordHash, now, now);
  });
  create.immediate();
  return ownerId;
}

export async function ensureDevelopmentOwner(
  database: Database.Database,
  username: string,
  password: string,
): Promise<string> {
  const existingOwnerId = getOwnerId(database);
  if (existingOwnerId) return existingOwnerId;

  const pending = developmentOwnerPromises.get(database);
  if (pending) return pending;

  const creation = createOwner(database, username, password).catch((error) => {
    if (error instanceof Error && error.message === "OWNER_EXISTS") {
      const concurrentOwnerId = getOwnerId(database);
      if (concurrentOwnerId) return concurrentOwnerId;
    }
    throw error;
  });
  developmentOwnerPromises.set(database, creation);
  try {
    return await creation;
  } finally {
    developmentOwnerPromises.delete(database);
  }
}

export async function createOwnerSession(
  database: Database.Database,
  username: string,
  password: string,
): Promise<{ ownerId: string; id: string; token: string }> {
  assertCredentialPolicy(username, password);
  const ownerId = randomUUID();
  const now = new Date();
  const passwordHash = await hash(password, { type: 2 });
  const storedUsername = displayUsername(username);
  const normalizedUsername = normalizeUsername(username);
  const session = prepareSession(ownerId, now);
  const create = database.transaction(() => {
    if (hasOwner(database)) throw new Error("OWNER_EXISTS");
    database
      .prepare(
        `INSERT INTO owner(
           id, username, username_normalized, password_hash, created_at, password_changed_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ownerId,
        storedUsername,
        normalizedUsername,
        passwordHash,
        now.toISOString(),
        now.toISOString(),
      );
    insertSession(database, session);
  });
  create.immediate();
  return { ownerId, id: session.id, token: session.token };
}

export async function authenticate(
  database: Database.Database,
  username: string,
  password: string,
  clientKey: string,
  now = new Date(),
): Promise<string | null> {
  const storedClientKey = clientKeyHash(clientKey);
  const attempt = database
    .prepare("SELECT failed_count, blocked_until FROM login_attempts WHERE client_key = ?")
    .get(storedClientKey) as { failed_count: number; blocked_until: string | null } | undefined;
  if (attempt?.blocked_until && new Date(attempt.blocked_until) > now) return null;
  const owner = database
    .prepare("SELECT id, password_hash FROM owner WHERE username_normalized = ?")
    .get(normalizeUsername(username)) as { id: string; password_hash: string } | undefined;
  if (!owner || !(await verify(owner.password_hash, password))) {
    recordFailedAttempt(database, storedClientKey, now);
    return null;
  }
  database.prepare("DELETE FROM login_attempts WHERE client_key = ?").run(storedClientKey);
  return owner.id;
}

export function issueSession(
  database: Database.Database,
  ownerId: string,
  now = new Date(),
): { id: string; token: string } {
  const session = prepareSession(ownerId, now);
  insertSession(database, session);
  return { id: session.id, token: session.token };
}

interface PreparedSession {
  id: string;
  ownerId: string;
  token: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
}

function prepareSession(ownerId: string, now: Date): PreparedSession {
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  return {
    id,
    ownerId,
    token,
    tokenHash: tokenHash(token),
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
}

function insertSession(database: Database.Database, session: PreparedSession): void {
  database
    .prepare(
      "INSERT INTO sessions(id, owner_id, token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      session.id,
      session.ownerId,
      session.tokenHash,
      session.createdAt,
      session.createdAt,
      session.expiresAt,
    );
}

export function readSession(
  database: Database.Database,
  token: string | undefined,
  now = new Date(),
): { id: string; ownerId: string; username: string; renewed: boolean } | null {
  if (!token) return null;
  const nowIso = now.toISOString();
  const session = database
    .prepare(
      `SELECT sessions.id, sessions.owner_id, sessions.last_seen_at, owner.username
       FROM sessions
       JOIN owner ON owner.id = sessions.owner_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .get(tokenHash(token), nowIso) as
    | { id: string; owner_id: string; username: string; last_seen_at: string }
    | undefined;
  if (!session) return null;
  const renewed =
    now.getTime() - new Date(session.last_seen_at).getTime() >= SESSION_TOUCH_INTERVAL_MS;
  if (renewed) {
    const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
    database
      .prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
      .run(nowIso, expiresAt, session.id);
  }
  return { id: session.id, ownerId: session.owner_id, username: session.username, renewed };
}

export async function resetOwnerCredentials(
  database: Database.Database,
  username: string,
  password: string,
): Promise<string> {
  assertCredentialPolicy(username, password);
  const now = new Date().toISOString();
  const passwordHash = await hash(password, { type: 2 });
  const storedUsername = displayUsername(username);
  const normalizedUsername = normalizeUsername(username);
  const existingOwnerId = getOwnerId(database);
  const ownerId = existingOwnerId ?? randomUUID();
  const reset = database.transaction(() => {
    if (existingOwnerId) {
      database
        .prepare(
          `UPDATE owner
           SET username = ?, username_normalized = ?, password_hash = ?, password_changed_at = ?
           WHERE id = ?`,
        )
        .run(storedUsername, normalizedUsername, passwordHash, now, ownerId);
    } else {
      database
        .prepare(
          `INSERT INTO owner(
             id, username, username_normalized, password_hash, created_at, password_changed_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(ownerId, storedUsername, normalizedUsername, passwordHash, now, now);
    }
    database.prepare("DELETE FROM sessions").run();
    database.prepare("DELETE FROM login_attempts").run();
  });
  reset.immediate();
  return ownerId;
}

export function revokeSession(database: Database.Database, sessionId: string): void {
  database.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export const SESSION_COOKIE_MAX_AGE = SESSION_DAYS * 86_400;
export { SESSION_COOKIE };
