// The synthetic seed data is deterministic and obeys every workflow invariant.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthService } from "../src/application/authService.ts";
import { steppingClock } from "../src/application/clock.ts";
import { RequestService } from "../src/application/requestService.ts";
import { openDatabase } from "../src/infrastructure/db.ts";
import { DEMO_PASSWORD, seedDemoData, seedUsers } from "../src/infrastructure/seed.ts";
import { demoUser, TEST_START } from "./helpers.ts";

function seeded() {
  const db = openDatabase(":memory:");
  seedDemoData(db);
  const clock = steppingClock(TEST_START);
  return { db, requests: new RequestService(db, clock), auth: new AuthService(db, clock) };
}

describe("seed data", () => {
  it("covers every status with valid histories", () => {
    const { requests } = seeded();
    const all = requests.list(demoUser("quinn"));
    assert.equal(all.length, 9);
    const statuses = new Set(all.map((request) => request.status));
    for (const status of ["PENDING_MANAGER", "PENDING_FINANCE", "PENDING_OPERATIONS", "APPROVED", "REJECTED", "WITHDRAWN"]) {
      assert.ok(statuses.has(status as never), status);
    }
    for (const summary of all) {
      const detail = requests.get(demoUser("quinn"), summary.id);
      assert.equal(detail.events.length, detail.version);
      assert.equal(detail.events.at(-1)?.toStatus, detail.status);
    }
  });

  it("is deterministic", () => {
    const first = seeded();
    const second = seeded();
    const snapshot = (fx: ReturnType<typeof seeded>) =>
      JSON.stringify(fx.requests.list(demoUser("quinn")).map((request) => fx.requests.get(demoUser("quinn"), request.id)));
    assert.equal(snapshot(first), snapshot(second));
  });

  it("lets every demo identity sign in with the documented password", () => {
    const { auth } = seeded();
    for (const user of auth.listUsers()) assert.equal(auth.login({ username: user.username, password: DEMO_PASSWORD }).user.id, user.id);
  });

  it("outside demo mode refuses only the shared demo password, not other passwords", () => {
    const clock = steppingClock(TEST_START);
    const demoDb = openDatabase(":memory:");
    seedDemoData(demoDb);
    const locked = new AuthService(demoDb, clock, undefined, { allowDemoPassword: false });
    for (const user of locked.listUsers()) {
      assert.throws(() => locked.login({ username: user.username, password: DEMO_PASSWORD }), { code: "INVALID_CREDENTIALS" });
    }
    const provisionedDb = openDatabase(":memory:");
    seedUsers(provisionedDb, "a-provisioned-secret");
    const provisioned = new AuthService(provisionedDb, clock, undefined, { allowDemoPassword: false });
    assert.equal(provisioned.login({ username: "avery", password: "a-provisioned-secret" }).user.username, "avery");
  });

  it("expires sessions after their time to live", () => {
    const db = openDatabase(":memory:");
    seedDemoData(db);
    const clock = steppingClock(TEST_START, 0);
    const auth = new AuthService(db, clock, 60_000);
    const session = auth.login({ username: "avery", password: DEMO_PASSWORD });
    assert.equal(auth.authenticate(session.token)?.username, "avery");
    clock.advance(60_001);
    assert.equal(auth.authenticate(session.token), null);
  });
});
