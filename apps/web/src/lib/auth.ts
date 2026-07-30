import "server-only";

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

import { openAppDatabase } from "@/lib/inventory/store";

const SESSION_DAYS = 30;

export type AuthAccount = { username: string; householdId: string };

function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}

function validPassword(password: string) { return password.length >= 6 && password.length <= 200; }

export class AuthStore {
  private readonly db = openAppDatabase();

  constructor() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS app_accounts (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      household_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_sessions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS app_sessions_lookup ON app_sessions (id, expires_at);`);
    const existing = this.db.prepare("SELECT username FROM app_accounts WHERE username = 'admin'").get();
    if (!existing) {
      const password = hashPassword("admin123");
      const now = new Date().toISOString();
      this.db.prepare("INSERT INTO app_accounts (username, password_hash, password_salt, household_id, created_at, updated_at) VALUES ('admin', ?, ?, NULL, ?, ?)")
        .run(password.hash, password.salt, now, now);
    }
  }

  login(username: string, password: string, legacyHouseholdId: string): { sessionId: string; account: AuthAccount } {
    const normalized = username.trim().toLowerCase();
    const row = this.db.prepare("SELECT username, password_hash, password_salt, household_id FROM app_accounts WHERE username = ?").get(normalized) as { username: string; password_hash: string; password_salt: string; household_id: string | null } | undefined;
    if (!row || !validPassword(password)) throw new Error("账号或密码不正确");
    const candidate = Buffer.from(hashPassword(password, row.password_salt).hash, "hex");
    const expected = Buffer.from(row.password_hash, "hex");
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) throw new Error("账号或密码不正确");
    const householdId = row.household_id ?? legacyHouseholdId;
    if (!row.household_id) this.db.prepare("UPDATE app_accounts SET household_id = ?, updated_at = ? WHERE username = ?").run(householdId, new Date().toISOString(), row.username);
    const sessionId = randomUUID();
    const now = new Date();
    this.db.prepare("INSERT INTO app_sessions (id, username, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(sessionId, row.username, new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString(), now.toISOString());
    return { sessionId, account: { username: row.username, householdId } };
  }

  session(sessionId: string | null): AuthAccount | null {
    if (!sessionId) return null;
    const row = this.db.prepare(`SELECT a.username, a.household_id FROM app_sessions s
      JOIN app_accounts a ON a.username = s.username WHERE s.id = ? AND s.expires_at > ?`).get(sessionId, new Date().toISOString()) as { username: string; household_id: string | null } | undefined;
    return row?.household_id ? { username: row.username, householdId: row.household_id } : null;
  }

  changePassword(username: string, currentPassword: string, nextPassword: string) {
    if (!validPassword(nextPassword)) throw new Error("新密码至少 6 位");
    const row = this.db.prepare("SELECT password_hash, password_salt FROM app_accounts WHERE username = ?").get(username) as { password_hash: string; password_salt: string } | undefined;
    if (!row) throw new Error("账号不存在");
    const candidate = Buffer.from(hashPassword(currentPassword, row.password_salt).hash, "hex");
    const expected = Buffer.from(row.password_hash, "hex");
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) throw new Error("当前密码不正确");
    const next = hashPassword(nextPassword);
    this.db.prepare("UPDATE app_accounts SET password_hash = ?, password_salt = ?, updated_at = ? WHERE username = ?")
      .run(next.hash, next.salt, new Date().toISOString(), username);
  }

  logout(sessionId: string | null) { if (sessionId) this.db.prepare("DELETE FROM app_sessions WHERE id = ?").run(sessionId); }
}

const globalForAuth = globalThis as unknown as { authStore?: AuthStore };
export function getAuthStore() { return globalForAuth.authStore ?? (globalForAuth.authStore = new AuthStore()); }
