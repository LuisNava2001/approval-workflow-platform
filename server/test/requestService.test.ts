// Use-case tests against a real (in-memory) SQLite database.

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { RequestDetailDto } from "../../shared/contracts.ts";
import { demoUser, serviceFixture, VALID_REQUEST, type ServiceFixture } from "./helpers.ts";

const avery = demoUser("avery");
const jordan = demoUser("jordan");
const morgan = demoUser("morgan");
const riley = demoUser("riley");
const taylor = demoUser("taylor");
const casey = demoUser("casey");
const quinn = demoUser("quinn");

describe("RequestService", () => {
  let fx: ServiceFixture;
  let request: RequestDetailDto;

  beforeEach(() => {
    fx = serviceFixture();
    request = fx.requests.create(avery, VALID_REQUEST);
  });

  it("creates a pending request with a SUBMITTED event", () => {
    assert.equal(request.reference, "REQ-0001");
    assert.equal(request.status, "PENDING_MANAGER");
    assert.equal(request.version, 1);
    assert.equal(request.totalCents, 240000);
    assert.deepEqual(request.events.map((event) => event.type), ["SUBMITTED"]);
    assert.deepEqual(request.allowedActions, ["WITHDRAW"]);
  });

  it("approves through manager, finance and operations with a full audit trail", () => {
    let current = fx.requests.transition(morgan, request.id, "APPROVE", { version: 1, comment: "Fine." });
    current = fx.requests.transition(taylor, current.id, "APPROVE", { version: current.version });
    current = fx.requests.transition(casey, current.id, "APPROVE", { version: current.version });
    assert.equal(current.status, "APPROVED");
    assert.equal(current.version, 4);
    assert.deepEqual(
      current.events.map((event) => [event.sequence, event.type, event.actor.role, event.toStatus]),
      [
        [1, "SUBMITTED", "REQUESTER", "PENDING_MANAGER"],
        [2, "APPROVED", "MANAGER", "PENDING_FINANCE"],
        [3, "APPROVED", "FINANCE", "PENDING_OPERATIONS"],
        [4, "APPROVED", "OPERATIONS", "APPROVED"],
      ],
    );
    assert.equal(current.events[1]?.comment, "Fine.");
  });

  it("rejects with a mandatory reason and stops the workflow", () => {
    assert.throws(() => fx.requests.transition(morgan, request.id, "REJECT", { version: 1 }), { code: "VALIDATION_FAILED" });
    const rejected = fx.requests.transition(morgan, request.id, "REJECT", { version: 1, comment: "Not in this quarter's plan." });
    assert.equal(rejected.status, "REJECTED");
    assert.throws(() => fx.requests.transition(taylor, request.id, "APPROVE", { version: 2 }), { code: "INVALID_TRANSITION" });
  });

  it("forbids acting out of stage, self-approval and auditor actions", () => {
    assert.throws(() => fx.requests.transition(taylor, request.id, "APPROVE", { version: 1 }), { code: "FORBIDDEN" });
    assert.throws(() => fx.requests.transition(quinn, request.id, "APPROVE", { version: 1 }), { code: "FORBIDDEN" });
    const own = fx.requests.create(morgan, VALID_REQUEST);
    assert.throws(() => fx.requests.transition(morgan, own.id, "APPROVE", { version: 1 }), { code: "FORBIDDEN" });
    assert.equal(fx.requests.transition(riley, own.id, "APPROVE", { version: 1 }).status, "PENDING_FINANCE");
    assert.throws(() => fx.requests.create(quinn, VALID_REQUEST), { code: "FORBIDDEN" });
  });

  it("lets only the owner withdraw", () => {
    assert.throws(() => fx.requests.transition(morgan, request.id, "WITHDRAW", { version: 1 }), { code: "FORBIDDEN" });
    assert.equal(fx.requests.transition(avery, request.id, "WITHDRAW", { version: 1 }).status, "WITHDRAWN");
  });

  it("hides other requesters' requests behind 404", () => {
    assert.throws(() => fx.requests.get(jordan, request.id), { code: "NOT_FOUND" });
    assert.throws(() => fx.requests.transition(jordan, request.id, "WITHDRAW", { version: 1 }), { code: "NOT_FOUND" });
    assert.throws(() => fx.requests.get(avery, 999), { code: "NOT_FOUND" });
    assert.equal(fx.requests.get(quinn, request.id).id, request.id);
    assert.deepEqual(fx.requests.list(jordan), []);
  });

  it("lists by scope, status and search text", () => {
    fx.requests.create(jordan, { ...VALID_REQUEST, title: "Monitor arm" });
    assert.equal(fx.requests.list(morgan).length, 2);
    assert.equal(fx.requests.list(morgan, { scope: "awaiting" }).length, 2);
    assert.equal(fx.requests.list(taylor, { scope: "awaiting" }).length, 0);
    assert.equal(fx.requests.list(avery, { scope: "mine" }).length, 1);
    assert.equal(fx.requests.list(morgan, { q: "monitor" }).length, 1);
    assert.equal(fx.requests.list(morgan, { q: "%" }).length, 0, "LIKE wildcards are escaped");
    assert.equal(fx.requests.list(morgan, { status: "APPROVED" }).length, 0);
    assert.throws(() => fx.requests.list(morgan, { status: "DONE" }), { code: "BAD_REQUEST" });
    assert.throws(() => fx.requests.list(morgan, { scope: "everything" }), { code: "BAD_REQUEST" });
  });

  it("builds a dashboard scoped to the viewer", () => {
    fx.requests.create(jordan, VALID_REQUEST);
    const approved = fx.requests.transition(morgan, request.id, "APPROVE", { version: 1 });
    const managerView = fx.requests.dashboard(morgan);
    assert.equal(managerView.counts.PENDING_MANAGER, 1);
    assert.equal(managerView.counts.PENDING_FINANCE, 1);
    assert.equal(managerView.awaitingMe.length, 1);
    assert.equal(managerView.openTotalCents, 480000);
    assert.equal(fx.requests.dashboard(taylor).awaitingMe[0]?.id, approved.id);
    const requesterView = fx.requests.dashboard(avery);
    assert.equal(requesterView.counts.PENDING_MANAGER + requesterView.counts.PENDING_FINANCE, 1);
    assert.ok(requesterView.recentActivity.every((event) => event.requestId === request.id));
  });
});
