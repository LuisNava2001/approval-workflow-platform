import { describe, expect, it, vi } from "vitest";
import { api, ApiError, setUnauthorizedHandler } from "../src/api.ts";

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("api client", () => {
  it("sends JSON with same-origin credentials and the version for transitions", async () => {
    const fetchMock = respond(200, { request: { id: 7 } });
    vi.stubGlobal("fetch", fetchMock);
    await api.transition(7, "REJECT", { version: 3, comment: "Not budgeted this quarter." });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/requests/7/reject");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ version: 3, comment: "Not budgeted this quarter." });
  });

  it("turns error bodies into ApiError with field details", async () => {
    vi.stubGlobal(
      "fetch",
      respond(422, { error: { code: "VALIDATION_FAILED", message: "Invalid", details: [{ field: "title", message: "Too short" }] } }),
    );
    const error = await api.createRequest({ title: "", category: "LAPTOP", quantity: 1, unitPrice: "1", justification: "", neededBy: "" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.fieldErrors()).toEqual({ title: "Too short" });
  });

  it("notifies the session layer on 401 UNAUTHENTICATED", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", respond(401, { error: { code: "UNAUTHENTICATED", message: "Sign in" } }));
    await expect(api.dashboard()).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledOnce();
    setUnauthorizedHandler(null);
  });

  it("builds list query strings from non-empty filters only", async () => {
    const fetchMock = respond(200, { requests: [] });
    vi.stubGlobal("fetch", fetchMock);
    await api.listRequests({ scope: "awaiting", status: "", q: "laptop" });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/requests?scope=awaiting&q=laptop");
  });

  it("survives non-JSON error pages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })));
    await expect(api.me()).rejects.toMatchObject({ status: 502, code: "INTERNAL" });
  });
});
