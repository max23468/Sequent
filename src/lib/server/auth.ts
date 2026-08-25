import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash, verify } from "argon2";
import type Database from "better-sqlite3";
import { SESSION_COOKIE, useSecureCookies } from "./config.ts";

const SESSION_DAYS = 365;
const developmentOwnerPromises = new WeakMap<Database.Database, Promise<string>>();

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

export async function createOwner(database: Database.Database, password: string): Promise<string> {
  const ownerId = randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hash(password, { type: 2 });
  const create = database.transaction(() => {
    if (hasOwner(database)) throw new Error("OWNER_EXISTS");
    database
      .prepare(
        "INSERT INTO owner(id, password_hash, created_at, password_changed_at) VALUES (?, ?, ?, ?)",
      )
      .run(ownerId, passwordHash, now, now);
  });
  create.immediate();
  return ownerId;
}

export async function ensureDevelopmentOwner(
  database: Database.Database,
  password: string,
): Promise<string> {
  const existingOwnerId = getOwnerId(database);
  if (existingOwnerId) return existingOwnerId;

  const pending = developmentOwnerPromises.get(database);
  if (pending) return pending;

  const creation = createOwner(database, password).catch((error) => {
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
  password: string,
): Promise<{ ownerId: string; id: string; token: string }> {
  const ownerId = randomUUID();
  const now = new Date();
  const passwordHash = await hash(password, { type: 2 });
  const session = prepareSession(ownerId, now);
  const create = database.transaction(() => {
    if (hasOwner(database)) throw new Error("OWNER_EXISTS");
    database
      .prepare(
        "INSERT INTO owner(id, password_hash, created_at, password_changed_at) VALUES (?, ?, ?, ?)",
      )
      .run(ownerId, passwordHash, now.toISOString(), now.toISOString());
    insertSession(database, session);
  });
  create.immediate();
  return { ownerId, id: session.id, token: session.token };
}

export async function authenticate(
  database: Database.Database,
  password: string,
  clientKey: string,
  now = new Date(),
): Promise<string | null> {
  const storedClientKey = clientKeyHash(clientKey);
  const attempt = database
    .prepare("SELECT failed_count, blocked_until FROM login_attempts WHERE client_key = ?")
    .get(storedClientKey) as { failed_count: number; blocked_until: string | null } | undefined;
  if (attempt?.blocked_until && new Date(attempt.blocked_until) > now) return null;
  const owner = database.prepare("SELECT id, password_hash FROM owner LIMIT 1").get() as
    | { id: string; password_hash: string }
    | undefined;
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
): { id: string; token: string } {
  const session = prepareSession(ownerId, new Date());
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
): { id: string; ownerId: string } | null {
  if (!token) return null;
  const now = new Date().toISOString();
  const session = database
    .prepare("SELECT id, owner_id FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .get(tokenHash(token), now) as { id: string; owner_id: string } | undefined;
  if (!session) return null;
  database.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, session.id);
  return { id: session.id, ownerId: session.owner_id };
}

export function revokeSession(database: Database.Database, sessionId: string): void {
  database.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function sessionCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: useSecureCookies(),
    maxAge: SESSION_DAYS * 86_400,
  };
}

export { SESSION_COOKIE };
