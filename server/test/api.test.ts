// Integration tests over real HTTP: authentication, authorization, input handling and full flows.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startServer, VALID_REQUEST, type Client, type TestServer } from "./helpers.ts";

let server: TestServer;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
});

async function createRequest(client: Client, overrides: object = {}) {
  const result = await client.post("/api/requests", { ...VALID_REQUEST, ...overrides });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.request;
}

describe("authentication", () => {
  it("issues an HttpOnly, SameSite=Strict session cookie on login", async () => {
    const client = server.client();
    const result = await client.login("avery");
    assert.equal(result.status, 200);
    assert.equal(result.body.user.username, "avery");
    assert.equal(result.body.user.passwordHash, undefined);
    const cookie = result.headers.get("set-cookie") ?? "";
    assert.match(cookie, /awp_session=[\w-]{20,}/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal((await client.get("/api/auth/me")).body.user.role, "REQUESTER");
  });

  it("rejects wrong passwords and unknown users with the same generic error", async () => {
    const wrongPassword = await server.client().login("avery", "not-the-password");
    const unknownUser = await server.client().login("mallory", "whatever");
    for (const result of [wrongPassword, unknownUser]) {
      assert.equal(result.status, 401);
      assert.equal(result.body.error.code, "INVALID_CREDENTIALS");
      assert.equal(result.headers.get("set-cookie"), null);
    }
    assert.equal(wrongPassword.body.error.message, unknownUser.body.error.message);
  });

  it("reports the session state without an error status", async () => {
    const client = server.client();
    const anonymous = await client.get("/api/auth/session");
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.body.user, null);
    await client.login("taylor");
    assert.equal((await client.get("/api/auth/session")).body.user.role, "FINANCE");
  });

  it("validates the login body", async () => {
    const result = await server.client().post("/api/auth/login", { username: "avery" });
    assert.equal(result.status, 422);
    assert.equal(result.body.error.details[0].field, "password");
  });

  it("requires a valid session on protected routes", async () => {
    const anonymous = server.client();
    for (const path of ["/api/auth/me", "/api/requests", "/api/dashboard", "/api/requests/1"]) {
      const result = await anonymous.get(path);
      assert.equal(result.status, 401, path);
      assert.equal(result.body.error.code, "UNAUTHENTICATED");
    }
    const forged = server.client();
    forged.setCookie("awp_session=forged-token-value-that-does-not-exist");
    assert.equal((await forged.get("/api/auth/me")).status, 401);
    assert.equal((await anonymous.post("/api/requests", VALID_REQUEST)).status, 401);
  });

  it("invalidates the session server-side on logout", async () => {
    const client = await server.as("jordan");
    const savedCookie = client.currentCookie();
    assert.equal((await client.get("/api/auth/me")).status, 200);
    const logout = await client.post("/api/auth/logout");
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);
    // Replaying the old cookie must fail: the session row is gone, not just the browser cookie.
    client.setCookie(savedCookie);
    assert.equal((await client.get("/api/auth/me")).status, 401);
  });
});

describe("authorization", () => {
  let requester: Client;
  let request: { id: number; version: number };

  before(async () => {
    requester = await server.as("avery");
    request = await createRequest(requester);
  });

  it("returns 403 when the role does not match the stage", async () => {
    for (const username of ["avery", "taylor", "casey", "quinn"]) {
      const client = await server.as(username);
      const result = await client.post(`/api/requests/${request.id}/approve`, { version: request.version });
      assert.equal(result.status, 403, username);
      assert.equal(result.body.error.code, "FORBIDDEN");
    }
  });

  it("blocks self-approval even for the right role", async () => {
    const morgan = await server.as("morgan");
    const own = await createRequest(morgan, { title: "Manager's own request" });
    const result = await morgan.post(`/api/requests/${own.id}/approve`, { version: own.version });
    assert.equal(result.status, 403);
    assert.match(result.body.error.message, /Separation of duties/);
  });

  it("hides other requesters' requests and blocks auditors from writing", async () => {
    const jordan = await server.as("jordan");
    assert.equal((await jordan.get(`/api/requests/${request.id}`)).status, 404);
    assert.equal((await jordan.post(`/api/requests/${request.id}/withdraw`, { version: request.version })).status, 404);
    const quinn = await server.as("quinn");
    assert.equal((await quinn.get(`/api/requests/${request.id}`)).status, 200);
    assert.equal((await quinn.post("/api/requests", VALID_REQUEST)).status, 403);
  });

  it("only lets the requester withdraw", async () => {
    const riley = await server.as("riley");
    assert.equal((await riley.post(`/api/requests/${request.id}/withdraw`, { version: request.version })).status, 403);
  });
});

describe("workflow over HTTP", () => {
  it("runs the full three-stage approval and exposes allowed actions per user", async () => {
    const avery = await server.as("avery");
    let request = await createRequest(avery, { title: "Full flow request" });
    assert.deepEqual(request.allowedActions, ["WITHDRAW"]);

    for (const username of ["morgan", "taylor", "casey"]) {
      const approver = await server.as(username);
      const view = (await approver.get(`/api/requests/${request.id}`)).body.request;
      assert.deepEqual(view.allowedActions, ["APPROVE", "REJECT"], username);
      const result = await approver.post(`/api/requests/${request.id}/approve`, { version: view.version, comment: `${username} ok` });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      request = result.body.request;
    }
    assert.equal(request.status, "APPROVED");
    assert.equal(request.events.length, 4);
    assert.deepEqual(request.allowedActions, []);

    const again = await (await server.as("casey")).post(`/api/requests/${request.id}/approve`, { version: request.version });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, "INVALID_TRANSITION");
  });

  it("requires a reason to reject and reports field errors", async () => {
    const request = await createRequest(await server.as("jordan"), { title: "Rejection path" });
    const morgan = await server.as("morgan");
    const missing = await morgan.post(`/api/requests/${request.id}/reject`, { version: 1 });
    assert.equal(missing.status, 422);
    assert.equal(missing.body.error.details[0].field, "comment");
    const ok = await morgan.post(`/api/requests/${request.id}/reject`, { version: 1, comment: "Duplicate of an approved request." });
    assert.equal(ok.body.request.status, "REJECTED");
  });

  it("returns 422 with every invalid field on create", async () => {
    const result = await (await server.as("avery")).post("/api/requests", { title: "", quantity: -1 });
    assert.equal(result.status, 422);
    const fields = result.body.error.details.map((detail: { field: string }) => detail.field).sort();
    assert.deepEqual(fields, ["category", "justification", "neededBy", "quantity", "title", "unitPrice"]);
  });

  it("lets exactly one of several concurrent approvals win", async () => {
    const request = await createRequest(await server.as("avery"), { title: "Concurrency check" });
    const morgan = await server.as("morgan");
    const riley = await server.as("riley");
    const attempts = [morgan, riley, morgan, riley, morgan].map((client) =>
      client.post(`/api/requests/${request.id}/approve`, { version: request.version }),
    );
    const statuses = (await Promise.all(attempts)).map((result) => result.status).sort();
    assert.deepEqual(statuses, [200, 409, 409, 409, 409]);
    const final = (await morgan.get(`/api/requests/${request.id}`)).body.request;
    assert.equal(final.version, 2);
    assert.equal(final.events.length, 2);
  });

  it("serves a dashboard consistent with the list", async () => {
    const morgan = await server.as("morgan");
    const dashboard = (await morgan.get("/api/dashboard")).body.dashboard;
    const list = (await morgan.get("/api/requests")).body.requests;
    const total = Object.values(dashboard.counts as Record<string, number>).reduce((sum, n) => sum + n, 0);
    assert.equal(total, list.length);
    assert.equal(dashboard.awaitingMe.length, (await morgan.get("/api/requests?scope=awaiting")).body.requests.length);
  });
});

describe("HTTP hardening", () => {
  it("sets security headers and never caches API responses", async () => {
    const result = await server.client().get("/api/health");
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(result.headers.get("x-content-type-options"), "nosniff");
    assert.equal(result.headers.get("x-frame-options"), "DENY");
    assert.match(result.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  });

  it("rejects non-JSON bodies, malformed JSON and oversized payloads", async () => {
    const client = await server.as("avery");
    const form = await client.post("/api/requests", "title=x", { "Content-Type": "application/x-www-form-urlencoded" });
    assert.equal(form.status, 415);
    const malformed = await client.post("/api/requests", "{not json");
    assert.equal(malformed.status, 400);
    const huge = await client.post("/api/requests", { ...VALID_REQUEST, justification: "x".repeat(40_000) });
    assert.equal(huge.status, 413);
  });

  it("answers unknown routes and wrong methods without leaking internals", async () => {
    const client = await server.as("avery");
    assert.equal((await client.get("/api/nope")).status, 404);
    assert.equal((await client.send("DELETE", "/api/requests")).status, 405);
    assert.equal((await client.post("/api/requests/1/teleport", { version: 1 })).status, 404);
    const bad = await client.get("/api/requests/abc");
    assert.equal(bad.status, 404);
    assert.equal(bad.body.error.stack, undefined);
  });

  it("exposes demo identities without credentials only in demo mode", async () => {
    const result = await server.client().get("/api/demo/identities");
    assert.equal(result.status, 200);
    assert.equal(result.body.identities.length, 7);
    assert.ok(result.body.identities.every((identity: object) => !("password_hash" in identity) && !("passwordHash" in identity)));
    const locked = await startServer({ demoMode: false });
    try {
      assert.equal((await locked.client().get("/api/demo/identities")).status, 404);
    } finally {
      await locked.close();
    }
  });

  it("refuses the shared demo password outside demo mode, with the same error as a wrong password", async () => {
    const locked = await startServer({ demoMode: false });
    try {
      const refused = await locked.client().login("morgan");
      const wrong = await locked.client().login("morgan", "not-the-password");
      assert.equal(refused.status, 401);
      assert.deepEqual(refused.body, wrong.body);
      assert.equal(refused.body.error.code, "INVALID_CREDENTIALS");
    } finally {
      await locked.close();
    }
    assert.equal((await server.client().login("morgan")).status, 200); // demo mode (the default) is unchanged
  });
});
