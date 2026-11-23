// Shared fixtures for the server tests.

import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthService } from "../src/application/authService.ts";
import { steppingClock } from "../src/application/clock.ts";
import { RequestService } from "../src/application/requestService.ts";
import { buildApplication, type Application } from "../src/composition.ts";
import { openDatabase, type Database } from "../src/infrastructure/db.ts";
import { DEMO_PASSWORD, demoUser, seedUsers } from "../src/infrastructure/seed.ts";

export { demoUser, DEMO_PASSWORD };

export const TEST_START = "2026-03-02T09:00:00.000Z";

export const VALID_REQUEST = {
  title: "Test laptop",
  category: "LAPTOP",
  quantity: 2,
  unitPrice: "1200.00",
  justification: "Needed for the automated test suite.",
  neededBy: "2026-04-01",
};

export function tempDirectory(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "awp-test-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface ServiceFixture {
  db: Database;
  clock: ReturnType<typeof steppingClock>;
  requests: RequestService;
  auth: AuthService;
}

export function serviceFixture(path = ":memory:", options: { seed?: boolean; busyTimeoutMs?: number } = {}): ServiceFixture {
  const db = openDatabase(path, { busyTimeoutMs: options.busyTimeoutMs ?? 5000 });
  if (options.seed ?? true) seedUsers(db);
  const clock = steppingClock(TEST_START, 1000);
  return { db, clock, requests: new RequestService(db, clock), auth: new AuthService(db, clock) };
}

export interface HttpResult {
  status: number;
  body: any;
  headers: Headers;
}

export class Client {
  private readonly base: string;
  private cookie: string | undefined;

  constructor(base: string) {
    this.base = base;
  }

  async send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<HttpResult> {
    const init: RequestInit = { method, headers: { ...headers } };
    if (this.cookie) (init.headers as Record<string, string>).Cookie = this.cookie;
    if (body !== undefined) {
      init.body = typeof body === "string" ? body : JSON.stringify(body);
      (init.headers as Record<string, string>)["Content-Type"] ??= "application/json";
    }
    const response = await fetch(this.base + path, init);
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  }

  get(path: string) {
    return this.send("GET", path);
  }

  post(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.send("POST", path, body, headers);
  }

  async login(username: string, password = DEMO_PASSWORD): Promise<HttpResult> {
    return this.post("/api/auth/login", { username, password });
  }

  setCookie(value: string | undefined): void {
    this.cookie = value;
  }

  currentCookie(): string | undefined {
    return this.cookie;
  }
}

export interface TestServer {
  base: string;
  app: Application;
  client: () => Client;
  as: (username: string) => Promise<Client>;
  close: () => Promise<void>;
}

export async function startServer(options: { databasePath?: string; demoMode?: boolean } = {}): Promise<TestServer> {
  const app = buildApplication({
    databasePath: options.databasePath ?? ":memory:",
    seedWhenEmpty: false,
    demoMode: options.demoMode ?? true,
    cookieSecure: false,
    webDist: null,
    clock: steppingClock(TEST_START, 1000),
  });
  seedUsers(app.db);
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    app,
    client: () => new Client(base),
    async as(username: string) {
      const client = new Client(base);
      const result = await client.login(username);
      if (result.status !== 200) throw new Error(`login failed for ${username}: ${result.status}`);
      return client;
    },
    close: () =>
      new Promise<void>((resolve) => {
        app.server.closeAllConnections();
        app.server.close(() => {
          app.db.close();
          resolve();
        });
      }),
  };
}

/** Deterministic pseudo-random generator (mulberry32) for repeatable randomized tests. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
