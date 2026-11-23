// `npm run seed`: recreate the local database with the synthetic demo data.

import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./infrastructure/db.ts";
import { DEMO_PASSWORD, seedDemoData } from "./infrastructure/seed.ts";

const databasePath = process.env.DATABASE_PATH ?? fileURLToPath(new URL("../../data/app.db", import.meta.url));
for (const suffix of ["", "-wal", "-shm"]) {
  if (existsSync(databasePath + suffix)) rmSync(databasePath + suffix);
}
const db = openDatabase(databasePath);
seedDemoData(db);
const count = (db.prepare("SELECT COUNT(*) AS n FROM requests").get() as { n: number }).n;
db.close();
console.log(`Seeded ${count} synthetic requests into ${databasePath}. Demo password: "${DEMO_PASSWORD}".`);
