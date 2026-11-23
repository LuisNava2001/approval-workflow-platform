import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RequestEventDto } from "../../shared/contracts.ts";
import { DEMO_PASSWORD } from "../../shared/demo.ts";
import { AuthProvider } from "../src/auth.tsx";
import { ActionPanel } from "../src/components/ActionPanel.tsx";
import { StageTracker } from "../src/components/StageTracker.tsx";
import { StatusBadge } from "../src/components/StatusBadge.tsx";
import { LoginPage } from "../src/pages/LoginPage.tsx";

describe("StatusBadge", () => {
  it("pairs the color with an icon and a text label", () => {
    render(<StatusBadge status="REJECTED" />);
    const badge = screen.getByText("Rejected").parentElement as HTMLElement;
    expect(badge.className).toContain("tone-critical");
    expect(badge.querySelector(".badge-icon")?.textContent).toBe("✕");
  });
});

describe("StageTracker", () => {
  it("marks the current stage for assistive technology", () => {
    const events: RequestEventDto[] = [
      {
        sequence: 2,
        type: "APPROVED",
        actor: { id: "u-m", displayName: "M", role: "MANAGER" },
        fromStatus: "PENDING_MANAGER",
        toStatus: "PENDING_FINANCE",
        comment: null,
        createdAt: "2026-03-02T09:00:00.000Z",
      },
    ];
    render(<StageTracker status="PENDING_FINANCE" events={events} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.className)).toEqual(["stage stage-done", "stage stage-current", "stage stage-upcoming"]);
    expect(items[1]?.getAttribute("aria-current")).toBe("step");
  });
});

describe("ActionPanel", () => {
  it("renders nothing when the server allows no action", () => {
    const { container } = render(<ActionPanel allowedActions={[]} busy={false} onSubmit={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows only the actions the server allowed", () => {
    render(<ActionPanel allowedActions={["WITHDRAW"]} busy={false} onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("requires a reason of at least 10 characters before rejecting", () => {
    const onSubmit = vi.fn();
    render(<ActionPanel allowedActions={["APPROVE", "REJECT"]} busy={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const confirm = screen.getByRole("button", { name: "Confirm rejection" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "too short" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: "Budget frozen until Q1." } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onSubmit).toHaveBeenCalledWith("REJECT", "Budget frozen until Q1.");
  });

  it("lets an approval go through without a comment", () => {
    const onSubmit = vi.fn();
    render(<ActionPanel allowedActions={["APPROVE", "REJECT"]} busy={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(onSubmit).toHaveBeenCalledWith("APPROVE", "");
  });
});

describe("LoginPage", () => {
  function mockApi(loginStatus = 200) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/session") return new Response(JSON.stringify({ user: null }), { status: 200 });
      if (url === "/api/demo/identities") {
        return new Response(
          JSON.stringify({ identities: [{ id: "u-morgan", username: "morgan", displayName: "Morgan Diaz", role: "MANAGER" }] }),
          { status: 200 },
        );
      }
      if (url === "/api/auth/login") {
        const body = JSON.parse(String(init?.body));
        return loginStatus === 200
          ? new Response(JSON.stringify({ user: { id: "u-morgan", username: body.username, displayName: "Morgan Diaz", role: "MANAGER" } }), { status: 200 })
          : new Response(JSON.stringify({ error: { code: "INVALID_CREDENTIALS", message: "Invalid username or password." } }), { status: 401 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("lists demo identities and signs in with the demo password", async () => {
    const fetchMock = mockApi();
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Sign in as Morgan/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/login")).toBe(true));
    const loginCall = fetchMock.mock.calls.find(([url]) => url === "/api/auth/login") as [string, RequestInit];
    expect(JSON.parse(String(loginCall[1].body))).toEqual({ username: "morgan", password: DEMO_PASSWORD });
  });

  it("shows the server's error for bad credentials", async () => {
    mockApi(401);
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );
    fireEvent.change(await screen.findByLabelText("Username"), { target: { value: "morgan" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Invalid username or password.");
  });
});
