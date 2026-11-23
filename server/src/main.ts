// Entry point: `npm start`. Configuration comes from environment variables with local defaults.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildApplication } from "./composition.ts";
import { DEMO_PASSWORD } from "./infrastructure/seed.ts";

const env = process.env;
const flag = (value: string | undefined, fallback: boolean) => (value === undefined ? fallback : value === "true");

const port = Number(env.PORT ?? 3000);
// Bind to loopback by default: this is a local demo, not an internet-facing service.
const host = env.HOST ?? "127.0.0.1";
const databasePath = env.DATABASE_PATH ?? fileURLToPath(new URL("../../data/app.db", import.meta.url));
const defaultDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
const webDist = env.WEB_DIST ?? (existsSync(defaultDist) ? defaultDist : null);
const demoMode = flag(env.DEMO_MODE, true);

const app = buildApplication({
  databasePath,
  seedWhenEmpty: flag(env.SEED_WHEN_EMPTY, true),
  demoMode,
  cookieSecure: flag(env.COOKIE_SECURE, false),
  webDist,
  log: (line) => console.log(`${new Date().toISOString()} ${line}`),
});

app.server.listen(port, host, () => {
  console.log(`Approval Workflow Platform listening on http://${host}:${port}`);
  console.log(webDist ? `Serving the web client from ${webDist}` : "Web client not built: run `npm run build`, or `npm run dev:web` for the Vite dev server.");
  if (demoMode) console.log(`Demo mode: sign in as any seeded identity with the password "${DEMO_PASSWORD}".`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.server.close(() => {
      app.db.close();
      process.exit(0);
    });
  });
}
