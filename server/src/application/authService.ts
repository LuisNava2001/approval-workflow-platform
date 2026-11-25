// Local demo authentication: scrypt-hashed passwords and opaque server-side sessions.
// Only a SHA-256 digest of each session token is stored, so a database leak does not leak sessions.

import { createHash, randomBytes } from "node:crypto";
import type { Role, UserDto } from "../../../shared/contracts.ts";
import { DEMO_PASSWORD } from "../../../shared/demo.ts";
import type { Database } from "../infrastructure/db.ts";
import { hashPassword, verifyPassword } from "../infrastructure/passwords.ts";
import type { Clock } from "./clock.ts";
import { invalidCredentials, validationFailed } from "./errors.ts";

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// Verified against when the username does not exist, so both failure paths cost one scrypt call.
const DUMMY_HASH = hashPassword("dummy-password-for-timing");

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  password_hash: string;
}

export interface Session {
  token: string;
  user: UserDto;
  expiresAt: string;
}

const tokenDigest = (token: string) => createHash("sha256").update(token).digest("hex");

export function toUserDto(row: UserRow): UserDto {
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
}

export class AuthService {
  private readonly db: Database;
  private readonly clock: Clock;
  private readonly ttlMs: number;
  private readonly allowDemoPassword: boolean;

  /**
   * `allowDemoPassword: false` (DEMO_MODE=false) refuses every sign-in that uses the shared, published demo
   * password, so seeded fictional accounts cannot be used outside demo mode whatever the database contains.
   */
  constructor(db: Database, clock: Clock, ttlMs = SESSION_TTL_MS, options: { allowDemoPassword?: boolean } = {}) {
    this.db = db;
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.allowDemoPassword = options.allowDemoPassword ?? true;
  }

  login(input: unknown): Session {
    const body = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
    const { username, password } = body;
    const errors = [];
    if (typeof username !== "string" || username.length === 0 || username.length > 64) {
      errors.push({ field: "username", message: "Required, at most 64 characters." });
    }
    if (typeof password !== "string" || password.length === 0 || password.length > 128) {
      errors.push({ field: "password", message: "Required, at most 128 characters." });
    }
    if (errors.length > 0) throw validationFailed(errors);

    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username as string) as UserRow | undefined;
    const passwordMatches = verifyPassword(password as string, row?.password_hash ?? DUMMY_HASH);
    // Same generic error as a wrong password: a caller cannot tell a disabled demo account from a bad guess.
    const demoPasswordRefused = !this.allowDemoPassword && password === DEMO_PASSWORD;
    if (!row || !passwordMatches || demoPasswordRefused) throw invalidCredentials();

    const now = this.clock.now();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + this.ttlMs).toISOString();
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now.toISOString());
    this.db
      .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(tokenDigest(token), row.id, now.toISOString(), expiresAt);
    return { token, user: toUserDto(row), expiresAt };
  }

  /** Resolve a session token to its user, or null when missing, unknown or expired. */
  authenticate(token: string | undefined): UserDto | null {
    if (!token || token.length > 128) return null;
    const row = this.db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(tokenDigest(token), this.clock.now().toISOString()) as UserRow | undefined;
    return row ? toUserDto(row) : null;
  }

  logout(token: string | undefined): void {
    if (token) this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenDigest(token));
  }

  listUsers(): UserDto[] {
    const rows = this.db.prepare("SELECT * FROM users ORDER BY role, display_name").all() as unknown as UserRow[];
    return rows.map(toUserDto);
  }
}
