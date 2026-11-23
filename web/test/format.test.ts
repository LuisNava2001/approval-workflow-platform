import { describe, expect, it } from "vitest";
import type { RequestEventDto, Role } from "../../shared/contracts.ts";
import { formatDate, formatHours, formatMoney, stageStates } from "../src/format.ts";
import { parseHash } from "../src/router.ts";

const event = (type: RequestEventDto["type"], role: Role): RequestEventDto => ({
  sequence: 1,
  type,
  actor: { id: `u-${role}`, displayName: role, role },
  fromStatus: null,
  toStatus: "PENDING_MANAGER",
  comment: null,
  createdAt: "2026-03-02T09:00:00.000Z",
});

describe("formatting", () => {
  it("formats cents as US dollars and dates in UTC", () => {
    expect(formatMoney(184900)).toBe("$1,849.00");
    expect(formatMoney(5)).toBe("$0.05");
    expect(formatDate("2026-03-02")).toBe("Mar 2, 2026");
  });

  it("formats cycle time in hours or days", () => {
    expect(formatHours(null)).toBe("No decisions yet");
    expect(formatHours(12.5)).toBe("12.5 h");
    expect(formatHours(72)).toBe("3.0 days");
  });
});

describe("stageStates", () => {
  it("marks a fresh request as waiting at the manager stage", () => {
    expect(stageStates("PENDING_MANAGER", [event("SUBMITTED", "REQUESTER")])).toEqual({
      MANAGER: "current",
      FINANCE: "upcoming",
      OPERATIONS: "upcoming",
    });
  });

  it("shows where a rejection happened and what was never reached", () => {
    const events = [event("SUBMITTED", "REQUESTER"), event("APPROVED", "MANAGER"), event("REJECTED", "FINANCE")];
    expect(stageStates("REJECTED", events)).toEqual({ MANAGER: "done", FINANCE: "rejected", OPERATIONS: "skipped" });
  });

  it("marks every stage done after full approval", () => {
    const events = [event("APPROVED", "MANAGER"), event("APPROVED", "FINANCE"), event("APPROVED", "OPERATIONS")];
    expect(Object.values(stageStates("APPROVED", events))).toEqual(["done", "done", "done"]);
  });
});

describe("parseHash", () => {
  it("routes known paths and rejects the rest", () => {
    expect(parseHash("")).toEqual({ name: "dashboard" });
    expect(parseHash("#/requests/42")).toEqual({ name: "request", id: 42 });
    expect(parseHash("#/requests?status=APPROVED").name).toBe("requests");
    expect(parseHash("#/requests/abc")).toEqual({ name: "not-found" });
    expect(parseHash("#/new")).toEqual({ name: "new" });
  });
});
