// Unit tests for the pure domain: state machine, authorization policy, validation and money.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTIONS, ROLES, STATUSES, type Action, type RequestStatus, type Role } from "../../shared/contracts.ts";
import { formatCents, parseMoneyToCents } from "../src/domain/money.ts";
import { allowedActions, authorize, canCreate, canView } from "../src/domain/policy.ts";
import { INITIAL_STATUS, isTerminal, nextStatus, stageRole, statusForStage, TRANSITIONS } from "../src/domain/stateMachine.ts";
import { validateNewRequest, validateTransition } from "../src/domain/validation.ts";
import { VALID_REQUEST } from "./helpers.ts";

describe("state machine", () => {
  it("starts at the manager stage and approves through three stages in order", () => {
    assert.equal(INITIAL_STATUS, "PENDING_MANAGER");
    let status: RequestStatus = INITIAL_STATUS;
    const visited: RequestStatus[] = [status];
    while (!isTerminal(status)) {
      status = nextStatus(status, "APPROVE") as RequestStatus;
      visited.push(status);
    }
    assert.deepEqual(visited, ["PENDING_MANAGER", "PENDING_FINANCE", "PENDING_OPERATIONS", "APPROVED"]);
  });

  it("allows reject and withdraw from every pending stage", () => {
    for (const status of ["PENDING_MANAGER", "PENDING_FINANCE", "PENDING_OPERATIONS"] as const) {
      assert.equal(nextStatus(status, "REJECT"), "REJECTED");
      assert.equal(nextStatus(status, "WITHDRAW"), "WITHDRAWN");
    }
  });

  it("has no transitions out of terminal states", () => {
    for (const status of ["APPROVED", "REJECTED", "WITHDRAWN"] as const) {
      assert.equal(isTerminal(status), true);
      for (const action of ACTIONS) assert.equal(nextStatus(status, action), null);
    }
  });

  it("defines every status and only known targets", () => {
    assert.deepEqual(Object.keys(TRANSITIONS).sort(), [...STATUSES].sort());
    for (const targets of Object.values(TRANSITIONS)) {
      for (const target of Object.values(targets)) assert.ok((STATUSES as readonly string[]).includes(target as string));
    }
  });

  it("maps pending statuses to the role that must act", () => {
    assert.equal(stageRole("PENDING_MANAGER"), "MANAGER");
    assert.equal(stageRole("PENDING_FINANCE"), "FINANCE");
    assert.equal(stageRole("PENDING_OPERATIONS"), "OPERATIONS");
    assert.equal(stageRole("APPROVED"), null);
    assert.equal(statusForStage("FINANCE"), "PENDING_FINANCE");
  });
});

describe("authorization policy", () => {
  const owner = { id: "u-owner", role: "REQUESTER" as Role };
  const actor = (role: Role, id = `u-${role.toLowerCase()}`) => ({ id, role });
  const request = (status: RequestStatus, requesterId = owner.id) => ({ status, requesterId });

  it("lets only the stage role approve or reject", () => {
    const stages: [RequestStatus, Role][] = [
      ["PENDING_MANAGER", "MANAGER"],
      ["PENDING_FINANCE", "FINANCE"],
      ["PENDING_OPERATIONS", "OPERATIONS"],
    ];
    for (const [status, stage] of stages) {
      for (const role of ROLES) {
        for (const action of ["APPROVE", "REJECT"] as Action[]) {
          const decision = authorize(actor(role), request(status), action);
          assert.equal(decision.allowed, role === stage, `${role} ${action} at ${status}`);
          if (!decision.allowed) assert.equal(decision.code, "FORBIDDEN");
        }
      }
    }
  });

  it("enforces separation of duties", () => {
    const manager = actor("MANAGER", "u-manager");
    const decision = authorize(manager, request("PENDING_MANAGER", manager.id), "APPROVE");
    assert.equal(decision.allowed, false);
    assert.match(decision.allowed ? "" : decision.reason, /Separation of duties/);
  });

  it("lets only the requester withdraw, and only while pending", () => {
    assert.equal(authorize(owner, request("PENDING_FINANCE"), "WITHDRAW").allowed, true);
    assert.equal(authorize(actor("MANAGER"), request("PENDING_FINANCE"), "WITHDRAW").allowed, false);
    const terminal = authorize(owner, request("APPROVED"), "WITHDRAW");
    assert.equal(terminal.allowed ? null : terminal.code, "INVALID_TRANSITION");
  });

  it("reports invalid transitions before role checks", () => {
    const decision = authorize(actor("AUDITOR"), request("REJECTED"), "APPROVE");
    assert.equal(decision.allowed ? null : decision.code, "INVALID_TRANSITION");
  });

  it("never allows the auditor to act", () => {
    for (const status of STATUSES) assert.deepEqual(allowedActions(actor("AUDITOR"), request(status)), []);
  });

  it("restricts visibility and creation", () => {
    assert.equal(canView(owner, request("APPROVED")), true);
    assert.equal(canView(actor("REQUESTER", "u-other"), request("APPROVED")), false);
    for (const role of ["MANAGER", "FINANCE", "OPERATIONS", "AUDITOR"] as Role[]) assert.equal(canView(actor(role), request("APPROVED")), true);
    assert.equal(canCreate(actor("AUDITOR")), false);
    assert.equal(canCreate(actor("FINANCE")), true);
  });

  it("computes allowed actions per actor", () => {
    assert.deepEqual(allowedActions(actor("MANAGER"), request("PENDING_MANAGER")), ["APPROVE", "REJECT"]);
    assert.deepEqual(allowedActions(owner, request("PENDING_MANAGER")), ["WITHDRAW"]);
    assert.deepEqual(allowedActions(actor("FINANCE"), request("PENDING_MANAGER")), []);
  });
});

describe("validation", () => {
  const today = "2026-03-02";

  it("accepts a valid request and converts money to cents", () => {
    const result = validateNewRequest(VALID_REQUEST, today);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.unitPriceCents, 120000);
  });

  it("reports every invalid field at once", () => {
    const result = validateNewRequest(
      { title: "x", category: "CAR", quantity: 0, unitPrice: "12.345", justification: "short", neededBy: "2026-02-30", extra: 1 },
      today,
    );
    assert.equal(result.ok, false);
    const fields = result.ok ? [] : result.errors.map((error) => error.field).sort();
    assert.deepEqual(fields, ["category", "extra", "justification", "neededBy", "quantity", "title", "unitPrice"]);
  });

  it("rejects past dates, fractional quantities and totals above the cap", () => {
    const fieldsOf = (input: object) => {
      const result = validateNewRequest({ ...VALID_REQUEST, ...input }, today);
      return result.ok ? [] : result.errors.map((error) => error.field);
    };
    assert.deepEqual(fieldsOf({ neededBy: "2026-03-01" }), ["neededBy"]);
    assert.deepEqual(fieldsOf({ quantity: 1.5 }), ["quantity"]);
    assert.deepEqual(fieldsOf({ quantity: 100, unitPrice: "10000.01" }), ["unitPrice"]);
    assert.deepEqual(fieldsOf({ unitPrice: 1200 }), ["unitPrice"]);
  });

  it("requires a version and a rejection reason", () => {
    assert.equal(validateTransition({ version: 1 }, "APPROVE").ok, true);
    assert.equal(validateTransition({ version: 0 }, "APPROVE").ok, false);
    assert.equal(validateTransition({ version: 1, comment: "too short" }, "REJECT").ok, false);
    assert.equal(validateTransition({ version: 1, comment: "Budget is exhausted." }, "REJECT").ok, true);
    assert.equal(validateTransition({ version: 1, sneaky: true }, "WITHDRAW").ok, false);
    assert.equal(validateTransition([], "APPROVE").ok, false);
  });
});

describe("money", () => {
  it("parses decimal strings into integer cents", () => {
    assert.equal(parseMoneyToCents("1299.5"), 129950);
    assert.equal(parseMoneyToCents(" 7 "), 700);
    assert.equal(parseMoneyToCents("1,299.00"), null);
    assert.equal(parseMoneyToCents("-5.00"), null);
    assert.equal(parseMoneyToCents(5), null);
  });

  it("formats cents with grouping", () => {
    assert.equal(formatCents(123456789), "1,234,567.89");
    assert.equal(formatCents(5), "0.05");
  });
});
