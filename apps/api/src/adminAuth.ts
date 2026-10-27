import Database from "better-sqlite3";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { IncomingMessage } from "node:http";
import { EventEmitter } from "node:events";

export const SESSION_COOKIE = "utm_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const equal = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const derive = (password: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key));
});
export const defaultDatabasePath = () => process.env.UTM_DATABASE_PATH ||
  join(homedir(), "Library", "Application Support", "UTM Web", "utm.sqlite");
export interface AdminSession { tokenHash: string; csrf: string; expiresAt: number; username: string }
interface Admin { username: string; password_hash: string; salt: string }

/** One local administrator. No host credentials or UTM data enter this database. */
export class AdminAuth extends EventEmitter {
  private readonly db: Database.Database;
  private readonly now: () => number;
  readonly setupCode = secret();
  private attempts = 0;
  private windowEnds = 0;
  private hashing = false;

  constructor(filename = defaultDatabasePath(), now = Date.now) {
    super();
    this.now = now;
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new Database(filename);
    try {
      if (filename !== ":memory:") chmodSync(filename, 0o600);
      // DELETE journaling keeps persistent credentials in one owner-only file.
      this.db.pragma("journal_mode = DELETE");
      this.db.pragma("foreign_keys = ON");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS auth_admin (
          id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL,
          password_hash TEXT NOT NULL, salt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS auth_sessions (
          token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL,
          admin_id INTEGER NOT NULL REFERENCES auth_admin(id)
        );
        CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
      `);
      this.db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(this.now());
    } catch (error) { this.db.close(); throw error; }
  }

  get configured(): boolean { return Boolean(this.db.prepare("SELECT id FROM auth_admin WHERE id = 1").get()); }

  private admitAttempt() {
    if (this.now() >= this.windowEnds) { this.attempts = 0; this.windowEnds = this.now() + 60000; }
    if (this.attempts >= 5 || this.hashing) throw new AuthError(429, "Too many attempts. Try again in a minute.");
    this.attempts++;
  }

  private credentials(username: unknown, password: unknown): { username: string; password: string } {
    if (typeof username !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(username) ||
      typeof password !== "string" || password.length < 12 || password.length > 128)
      throw new AuthError(400, "Use a username of 1–64 letters, numbers, dots, underscores or hyphens and a password of 12–128 characters.");
    return { username, password };
  }

  async setup(username: unknown, password: unknown, code: unknown) {
    if (this.configured) throw new AuthError(409, "Setup has already been completed.");
    this.admitAttempt();
    if (typeof code !== "string" || !equal(this.setupCode, code)) throw new AuthError(403, "Invalid setup code. Use the code shown in the server log.");
    const credentials = this.credentials(username, password);
    const salt = secret();
    this.hashing = true;
    let hash: Buffer;
    try { hash = await derive(credentials.password, salt); } finally { this.hashing = false; }
    // The fixed primary key and transaction make first-admin creation atomic, including across processes.
    this.db.transaction(() => {
      if (this.configured) throw new AuthError(409, "Setup has already been completed.");
      this.db.prepare("INSERT INTO auth_admin VALUES (1, ?, ?, ?)")
        .run(credentials.username, hash.toString("hex"), salt);
    }).immediate();
    this.attempts = 0;
  }

  async login(username: unknown, password: unknown): Promise<{ token: string; session: AdminSession }> {
    this.admitAttempt();
    if (!this.configured) throw new AuthError(409, "Complete initial setup first.");
    const credentials = this.credentials(username, password);
    const admin = this.db.prepare("SELECT * FROM auth_admin WHERE id = 1").get() as Admin;
    this.hashing = true;
    let hash: Buffer;
    try { hash = await derive(credentials.password, admin.salt); } finally { this.hashing = false; }
    if (!equal(admin.username, credentials.username) || !equal(admin.password_hash, hash.toString("hex")))
      throw new AuthError(401, "Invalid username or password.");
    const token = secret();
    const session = { tokenHash: digest(token), csrf: secret(), expiresAt: this.now() + SESSION_TTL_MS, username: admin.username };
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(this.now());
      // Bound storage even when a browser repeatedly signs in without logging out.
      this.db.prepare(`DELETE FROM auth_sessions WHERE token_hash IN
        (SELECT token_hash FROM auth_sessions ORDER BY expires_at DESC LIMIT -1 OFFSET 19)`).run();
      this.db.prepare("INSERT INTO auth_sessions VALUES (?, ?, ?, 1)")
        .run(session.tokenHash, session.csrf, session.expiresAt);
    })();
    this.attempts = 0;
    return { token, session };
  }

  session(req: IncomingMessage): AdminSession | undefined {
    const cookies = (req.headers.cookie || "").split(";").map(value => value.trim());
    const tokens = cookies.filter(value => value.startsWith(`${SESSION_COOKIE}=`));
    if (tokens.length !== 1) return undefined;
    const token = tokens[0]!.slice(SESSION_COOKIE.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    return this.db.prepare(`SELECT token_hash AS tokenHash, csrf, expires_at AS expiresAt, username
      FROM auth_sessions JOIN auth_admin ON auth_admin.id = auth_sessions.admin_id
      WHERE token_hash = ? AND expires_at > ?`).get(digest(token), this.now()) as AdminSession | undefined;
  }

  logout(session: AdminSession) {
    this.db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(session.tokenHash);
    this.emit("revoked", session.tokenHash);
  }

  close() { this.emit("shutdown"); this.db.close(); }
}
export class AuthError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
