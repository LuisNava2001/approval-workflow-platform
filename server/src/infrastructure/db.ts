// SQLite access through Node's built-in node:sqlite module: no native add-ons, no ORM.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CATEGORIES, EVENT_TYPES, ROLES, STATUSES } from "../../../shared/contracts.ts";
import { serviceBusy } from "../application/errors.ts";

export type Database = DatabaseSync;

const list = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/** Ordered schema migrations. The index + 1 is stored in PRAGMA user_version. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN (${list(ROLES)})),
    password_hash TEXT NOT NULL
  ) STRICT;

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE requests (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    title            TEXT    NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
    category         TEXT    NOT NULL CHECK (category IN (${list(CATEGORIES)})),
    quantity         INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
    justification    TEXT    NOT NULL CHECK (length(justification) BETWEEN 10 AND 1000),
    needed_by        TEXT    NOT NULL,
    status           TEXT    NOT NULL CHECK (status IN (${list(STATUSES)})),
    requester_id     TEXT    NOT NULL REFERENCES users(id),
    version          INTEGER NOT NULL CHECK (version >= 1),
    created_at       TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL
  ) STRICT;
  CREATE INDEX idx_requests_status ON requests(status);
  CREATE INDEX idx_requests_requester ON requests(requester_id);

  CREATE TABLE request_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id  INTEGER NOT NULL REFERENCES requests(id),
    sequence    INTEGER NOT NULL CHECK (sequence >= 1),
    type        TEXT    NOT NULL CHECK (type IN (${list(EVENT_TYPES)})),
    actor_id    TEXT    NOT NULL REFERENCES users(id),
    actor_role  TEXT    NOT NULL CHECK (actor_role IN (${list(ROLES)})),
    from_status TEXT    CHECK (from_status IS NULL OR from_status IN (${list(STATUSES)})),
    to_status   TEXT    NOT NULL CHECK (to_status IN (${list(STATUSES)})),
    comment     TEXT,
    created_at  TEXT    NOT NULL,
    UNIQUE (request_id, sequence)
  ) STRICT;

  -- The audit history is append-only: the database itself refuses edits and deletions.
  CREATE TRIGGER request_events_no_update BEFORE UPDATE ON request_events
  BEGIN SELECT RAISE(ABORT, 'request_events is append-only'); END;
  CREATE TRIGGER request_events_no_delete BEFORE DELETE ON request_events
  BEGIN SELECT RAISE(ABORT, 'request_events is append-only'); END;
  `,
];

export interface OpenOptions {
  busyTimeoutMs?: number;
}

export function openDatabase(path: string, options: OpenOptions = {}): Database {
  const busyTimeoutMs = options.busyTimeoutMs ?? 5000;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) throw new Error("busyTimeoutMs must be a non-negative integer");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${busyTimeoutMs};`);
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

export function schemaVersion(db: Database): number {
  return Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
}

export function migrate(db: Database): void {
  for (let index = schemaVersion(db); index < MIGRATIONS.length; index += 1) {
    withTransaction(db, () => {
      db.exec(MIGRATIONS[index] as string);
      db.exec(`PRAGMA user_version = ${index + 1}`);
    });
  }
}

/** True when SQLite reports that another connection holds the write lock. */
export function isBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { errcode?: number }).errcode;
  return code === 5 || code === 6 || /database is (locked|busy)/i.test(error.message);
}

/**
 * Run `work` inside BEGIN IMMEDIATE ... COMMIT. IMMEDIATE takes the write lock up front, so two
 * writers serialize instead of failing halfway through. Lock contention surfaces as SERVICE_BUSY.
 */
export function withTransaction<T>(db: Database, work: () => T): T {
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch (error) {
    if (isBusyError(error)) throw serviceBusy();
    throw error;
  }
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    if (isBusyError(error)) throw serviceBusy();
    throw error;
  }
}
