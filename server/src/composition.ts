// Composition root: builds the database, services and HTTP handler from a configuration object.

import { createServer, type Server } from "node:http";
import { AuthService, SESSION_TTL_MS } from "./application/authService.ts";
import { systemClock, type Clock } from "./application/clock.ts";
import { RequestService } from "./application/requestService.ts";
import { createApp } from "./http/app.ts";
import { openDatabase, type Database } from "./infrastructure/db.ts";
import { isEmpty, seedDemoData } from "./infrastructure/seed.ts";

export interface AppConfig {
  databasePath: string;
  seedWhenEmpty: boolean;
  demoMode: boolean;
  cookieSecure: boolean;
  webDist: string | null;
  clock?: Clock;
  busyTimeoutMs?: number;
  log?: (line: string) => void;
}

export interface Application {
  server: Server;
  db: Database;
  auth: AuthService;
  requests: RequestService;
}

export function buildApplication(config: AppConfig): Application {
  const clock = config.clock ?? systemClock;
  const db = openDatabase(config.databasePath, { busyTimeoutMs: config.busyTimeoutMs ?? 5000 });
  if (config.seedWhenEmpty && isEmpty(db)) seedDemoData(db);
  const auth = new AuthService(db, clock, SESSION_TTL_MS, { allowDemoPassword: config.demoMode });
  const requests = new RequestService(db, clock);
  const handler = createApp({
    auth,
    requests,
    demoMode: config.demoMode,
    cookieSecure: config.cookieSecure,
    sessionTtlSeconds: Math.floor(SESSION_TTL_MS / 1000),
    webDist: config.webDist,
    ...(config.log ? { log: config.log } : {}),
  });
  return { server: createServer(handler), db, auth, requests };
}
