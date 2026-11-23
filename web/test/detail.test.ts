import { describe, expect, it } from "vitest";
import type { RequestDetailDto, UserDto } from "../../shared/contracts.ts";
import { statusNote } from "../src/pages/RequestDetailPage.tsx";

const morgan: UserDto = { id: "u-morgan", username: "morgan", displayName: "Morgan Diaz", role: "MANAGER" };
const taylor: UserDto = { id: "u-taylor", username: "taylor", displayName: "Taylor Kim", role: "FINANCE" };

function request(overrides: Partial<RequestDetailDto>): RequestDetailDto {
  return {
    id: 6,
    reference: "REQ-0006",
    title: "Conference room camera",
    category: "PERIPHERAL",
    quantity: 1,
    unitPriceCents: 69900,
    totalCents: 69900,
    currency: "USD",
    status: "PENDING_MANAGER",
    currentStage: "MANAGER",
    requester: { id: "u-avery", displayName: "Avery Brooks" },
    createdAt: "2026-03-02T09:00:00.000Z",
    updatedAt: "2026-03-02T09:00:00.000Z",
    version: 1,
    justification: "Remote participants cannot see the whiteboard.",
    neededBy: "2026-04-01",
    events: [],
    allowedActions: [],
    ...overrides,
  };
}

describe("statusNote", () => {
  it("explains separation of duties even when the owner can still withdraw", () => {
    const own = request({ requester: { id: morgan.id, displayName: morgan.displayName }, allowedActions: ["WITHDRAW"] });
    expect(statusNote(own, morgan)).toMatch(/Separation of duties: another Manager/);
  });

  it("stays silent when the user can decide", () => {
    expect(statusNote(request({ allowedActions: ["APPROVE", "REJECT"] }), morgan)).toBeNull();
  });

  it("tells other roles who must act and marks closed requests as final", () => {
    expect(statusNote(request({}), taylor)).toBe("Waiting for Manager. Your role cannot act at this stage.");
    expect(statusNote(request({ status: "APPROVED", currentStage: null }), taylor)).toMatch(/closed/);
  });
});
