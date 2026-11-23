import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RequestDetailDto, UserDto } from "../../shared/contracts.ts";
import { RequestDetailPage } from "../src/pages/RequestDetailPage.tsx";

const riley: UserDto = { id: "u-riley", username: "riley", displayName: "Riley Chen", role: "MANAGER" };

const pending: RequestDetailDto = {
  id: 3,
  reference: "REQ-0003",
  title: "Noise-cancelling headsets",
  category: "PERIPHERAL",
  quantity: 4,
  unitPriceCents: 18900,
  totalCents: 75600,
  currency: "USD",
  status: "PENDING_MANAGER",
  currentStage: "MANAGER",
  requester: { id: "u-avery", displayName: "Avery Brooks" },
  createdAt: "2026-10-11T18:10:00.000Z",
  updatedAt: "2026-10-11T18:10:00.000Z",
  version: 1,
  justification: "The open-plan support area is too loud for customer calls.",
  neededBy: "2026-12-15",
  events: [],
  allowedActions: ["APPROVE", "REJECT"],
};

describe("RequestDetailPage", () => {
  it("turns a 409 conflict into a warning with a reload button instead of overwriting", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(JSON.stringify({ error: { code: "CONFLICT", message: "This request changed since you loaded it." } }), { status: 409 })
        : new Response(JSON.stringify({ request: pending }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<RequestDetailPage id={3} user={riley} />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));

    expect(await screen.findByText(/This request changed since you loaded it/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload request" })).toBeTruthy();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST") as [string, RequestInit];
    expect(post[0]).toBe("/api/requests/3/approve");
    expect(JSON.parse(String(post[1].body))).toEqual({ version: 1 });
  });
});
