// Data integrity, concurrency and persistence tests.

import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { Action, RequestStatus } from "../../shared/contracts.ts";
import type { AppError } from "../src/application/errors.ts";
import { schemaVersion, withTransaction } from "../src/infrastructure/db.ts";
import { DEMO_USERS } from "../src/infrastructure/seed.ts";
import { demoUser, seededRandom, serviceFixture, tempDirectory, VALID_REQUEST } from "./helpers.ts";

describe("database integrity", () => {
  it("keeps the audit history append-only", () => {
    const fx = serviceFixture();
    fx.requests.create(demoUser("avery"), VALID_REQUEST);
    assert.throws(() => fx.db.exec("UPDATE request_events SET comment = 'edited'"), /append-only/);
    assert.throws(() => fx.db.exec("DELETE FROM request_events"), /append-only/);
  });

  it("enforces CHECK constraints and foreign keys", () => {
    const fx = serviceFixture();
    const created = fx.requests.create(demoUser("avery"), VALID_REQUEST);
    assert.throws(() => fx.db.exec(`UPDATE requests SET status = 'DONE' WHERE id = ${created.id}`), /CHECK constraint/);
    assert.throws(() => fx.db.exec(`UPDATE requests SET quantity = 0 WHERE id = ${created.id}`), /CHECK constraint/);
    assert.throws(
      () =>
        fx.db.exec(
          `INSERT INTO request_events (request_id, sequence, type, actor_id, actor_role, to_status, created_at)
           VALUES (${created.id}, 2, 'APPROVED', 'u-nobody', 'MANAGER', 'PENDING_FINANCE', 'now')`,
        ),
      /FOREIGN KEY/,
    );
    assert.throws(() => fx.db.exec(`DELETE FROM requests WHERE id = ${created.id}`), /FOREIGN KEY/);
  });

  it("rolls back the status change when the audit insert fails", () => {
    const fx = serviceFixture();
    const created = fx.requests.create(demoUser("avery"), VALID_REQUEST);
    fx.db.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON request_events WHEN NEW.comment = 'boom'
                BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END;`);
    assert.throws(() => fx.requests.transition(demoUser("morgan"), created.id, "APPROVE", { version: 1, comment: "boom" }), /simulated/);
    const after = fx.requests.get(demoUser("morgan"), created.id);
    assert.equal(after.status, "PENDING_MANAGER");
    assert.equal(after.version, 1);
    assert.equal(after.events.length, 1);
  });
});

describe("concurrency", () => {
  it("rejects a stale version with CONFLICT and leaves state untouched", () => {
    const fx = serviceFixture();
    const created = fx.requests.create(demoUser("avery"), VALID_REQUEST);
    fx.requests.transition(demoUser("morgan"), created.id, "APPROVE", { version: 1 });
    assert.throws(() => fx.requests.transition(demoUser("riley"), created.id, "REJECT", { version: 1, comment: "Too late to object." }), {
      code: "CONFLICT",
    });
    const current = fx.requests.get(demoUser("riley"), created.id);
    assert.equal(current.status, "PENDING_FINANCE");
    assert.equal(current.events.length, 2);
  });

  describe("across two connections to the same database file", () => {
    const tmp = tempDirectory();
    const path = join(tmp.dir, "shared.db");
    const first = serviceFixture(path);
    const second = serviceFixture(path, { seed: false, busyTimeoutMs: 50 });
    after(() => {
      first.db.close();
      second.db.close();
      tmp.cleanup();
    });

    it("prevents lost updates between writers that read the same version", () => {
      const created = first.requests.create(demoUser("avery"), VALID_REQUEST);
      const seenByA = first.requests.get(demoUser("morgan"), created.id);
      const seenByB = second.requests.get(demoUser("riley"), created.id);
      first.requests.transition(demoUser("morgan"), created.id, "APPROVE", { version: seenByA.version });
      assert.throws(
        () => second.requests.transition(demoUser("riley"), created.id, "REJECT", { version: seenByB.version, comment: "Conflicting decision." }),
        { code: "CONFLICT" },
      );
      assert.equal(second.requests.get(demoUser("riley"), created.id).status, "PENDING_FINANCE");
    });

    it("reports SERVICE_BUSY while another connection holds the write lock, then succeeds", () => {
      const created = first.requests.create(demoUser("avery"), VALID_REQUEST);
      first.db.exec("BEGIN IMMEDIATE");
      try {
        assert.throws(() => second.requests.transition(demoUser("morgan"), created.id, "APPROVE", { version: 1 }), (error: AppError) => {
          assert.equal(error.code, "SERVICE_BUSY");
          assert.equal(error.status, 503);
          return true;
        });
      } finally {
        first.db.exec("ROLLBACK");
      }
      assert.equal(second.requests.transition(demoUser("morgan"), created.id, "APPROVE", { version: 1 }).status, "PENDING_FINANCE");
    });
  });

  it("keeps invariants under a long randomized sequence of operations", () => {
    const fx = serviceFixture();
    const random = seededRandom(20261123);
    const actors = DEMO_USERS.map((user) => demoUser(user.username));
    const actions: Action[] = ["APPROVE", "REJECT", "WITHDRAW"];
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const ids: number[] = [];
    const outcomes: Record<string, number> = {};

    for (let step = 0; step < 400; step += 1) {
      if (ids.length === 0 || random() < 0.2) {
        const creator = pick(actors.filter((actor) => actor.role !== "AUDITOR"));
        ids.push(fx.requests.create(creator, VALID_REQUEST).id);
        continue;
      }
      const id = pick(ids);
      const before = fx.requests.get(demoUser("quinn"), id);
      // 60% of steps pick a plausible actor for the stage, the rest are fully random (mostly denied).
      let actor = pick(actors);
      let action = pick(actions);
      if (before.currentStage && random() < 0.6) {
        const roll = random();
        const approvers = actors.filter((candidate) => candidate.role === before.currentStage && candidate.id !== before.requester.id);
        if (roll < 0.1) {
          actor = actors.find((candidate) => candidate.id === before.requester.id) ?? actor;
          action = "WITHDRAW";
        } else if (approvers.length > 0) {
          actor = pick(approvers);
          action = roll < 0.8 ? "APPROVE" : "REJECT";
        }
      }
      const stale = random() < 0.1;
      try {
        fx.requests.transition(actor, id, action, {
          version: stale ? before.version - 1 || 99 : before.version,
          comment: "Randomized decision comment.",
        });
        outcomes.ok = (outcomes.ok ?? 0) + 1;
      } catch (error) {
        const code = (error as AppError).code;
        assert.ok(["FORBIDDEN", "INVALID_TRANSITION", "CONFLICT", "NOT_FOUND"].includes(code), `unexpected ${code}`);
        outcomes[code] = (outcomes[code] ?? 0) + 1;
        const unchanged = fx.requests.get(demoUser("quinn"), id);
        assert.equal(unchanged.version, before.version, "a failed transition must not change the request");
      }
    }

    const auditor = demoUser("quinn");
    for (const id of ids) {
      const request = fx.requests.get(auditor, id);
      assert.equal(request.events.length, request.version, "one audit event per version");
      assert.deepEqual(request.events.map((event) => event.sequence), request.events.map((_, index) => index + 1));
      assert.equal(request.events.at(-1)?.toStatus, request.status, "status matches the last event");
      const approvals = request.events.filter((event) => event.type === "APPROVED").map((event) => event.actor.role);
      assert.deepEqual(approvals, ["MANAGER", "FINANCE", "OPERATIONS"].slice(0, approvals.length), "stages are sequential");
      for (const event of request.events.slice(1)) {
        assert.notEqual(event.type === "APPROVED" || event.type === "REJECTED" ? event.actor.id : null, request.requester.id, "no self-decisions");
      }
    }
    const summary = JSON.stringify(outcomes);
    assert.ok((outcomes.ok ?? 0) > 50, `the random walk exercised successful transitions: ${summary}`);
    assert.ok((outcomes.CONFLICT ?? 0) > 0 && (outcomes.FORBIDDEN ?? 0) > 0 && (outcomes.INVALID_TRANSITION ?? 0) > 0, summary);
    const finalStatuses = new Set(ids.map((id) => fx.requests.get(auditor, id).status));
    for (const terminal of ["APPROVED", "REJECTED", "WITHDRAWN"] as const) assert.ok(finalStatuses.has(terminal), `reached ${terminal}`);
  });
});

describe("persistence", () => {
  const tmp = tempDirectory();
  const path = join(tmp.dir, "persist.db");
  let createdId = 0;

  before(() => {
    const fx = serviceFixture(path);
    createdId = fx.requests.create(demoUser("avery"), VALID_REQUEST).id;
    fx.requests.transition(demoUser("morgan"), createdId, "APPROVE", { version: 1, comment: "Persist me." });
    fx.db.close();
  });
  after(() => tmp.cleanup());

  it("survives closing and reopening the database", () => {
    const reopened = serviceFixture(path, { seed: false });
    const request = reopened.requests.get(demoUser("quinn"), createdId);
    assert.equal(request.status satisfies RequestStatus, "PENDING_FINANCE");
    assert.equal(request.events[1]?.comment, "Persist me.");
    assert.equal(schemaVersion(reopened.db), 1, "migrations are not re-applied");
    reopened.db.close();
  });

  it("rolls back a failed transaction completely", () => {
    const fx = serviceFixture(path, { seed: false });
    assert.throws(() =>
      withTransaction(fx.db, () => {
        fx.db.exec(`UPDATE requests SET title = 'Should not persist' WHERE id = ${createdId}`);
        throw new Error("abort");
      }),
    );
    assert.equal(fx.requests.get(demoUser("quinn"), createdId).title, VALID_REQUEST.title);
    fx.db.close();
  });
});
