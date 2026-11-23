// Synthetic demo data. Every person, item and amount here is fictional.
// Requests are created through RequestService, so seeded data obeys the same rules as live data.

import type { Role, UserDto } from "../../../shared/contracts.ts";
import { DEMO_PASSWORD } from "../../../shared/demo.ts";
import { steppingClock } from "../application/clock.ts";
import { RequestService } from "../application/requestService.ts";
import type { Database } from "./db.ts";
import { hashPassword } from "./passwords.ts";

export { DEMO_PASSWORD };

export const DEMO_USERS: readonly { id: string; username: string; displayName: string; role: Role }[] = [
  { id: "u-avery", username: "avery", displayName: "Avery Brooks", role: "REQUESTER" },
  { id: "u-jordan", username: "jordan", displayName: "Jordan Lee", role: "REQUESTER" },
  { id: "u-morgan", username: "morgan", displayName: "Morgan Diaz", role: "MANAGER" },
  { id: "u-riley", username: "riley", displayName: "Riley Chen", role: "MANAGER" },
  { id: "u-taylor", username: "taylor", displayName: "Taylor Kim", role: "FINANCE" },
  { id: "u-casey", username: "casey", displayName: "Casey Patel", role: "OPERATIONS" },
  { id: "u-quinn", username: "quinn", displayName: "Quinn Foster", role: "AUDITOR" },
];

export function seedUsers(db: Database, password = DEMO_PASSWORD): void {
  const insert = db.prepare(
    "INSERT INTO users (id, username, display_name, role, password_hash) VALUES (?, ?, ?, ?, ?)",
  );
  const passwordHash = hashPassword(password);
  for (const user of DEMO_USERS) insert.run(user.id, user.username, user.displayName, user.role, passwordHash);
}

export function demoUser(username: string): UserDto {
  const user = DEMO_USERS.find((candidate) => candidate.username === username);
  if (!user) throw new Error(`unknown demo user ${username}`);
  return { ...user };
}

type Step = [actor: string, action: "APPROVE" | "REJECT" | "WITHDRAW", comment?: string];

interface SampleRequest {
  requester: string;
  title: string;
  category: "LAPTOP" | "MONITOR" | "PERIPHERAL" | "MOBILE_DEVICE" | "NETWORKING" | "OTHER";
  quantity: number;
  unitPrice: string;
  justification: string;
  neededBy: string;
  steps: Step[];
}

const SAMPLE_REQUESTS: SampleRequest[] = [
  {
    requester: "avery", title: "Developer laptop, 14-inch", category: "LAPTOP", quantity: 1, unitPrice: "1849.00",
    justification: "Current laptop is five years old and cannot run the local build within a reasonable time.",
    neededBy: "2026-10-30",
    steps: [["morgan", "APPROVE", "Within the team hardware budget."], ["taylor", "APPROVE"], ["casey", "APPROVE", "Imaging scheduled."]],
  },
  {
    requester: "jordan", title: "27-inch monitors for the design station", category: "MONITOR", quantity: 2, unitPrice: "329.00",
    justification: "Colour-accurate displays are needed for the new design review workflow.",
    neededBy: "2026-11-20",
    steps: [["riley", "APPROVE"], ["taylor", "APPROVE", "Approved under the Q4 equipment line."]],
  },
  {
    requester: "avery", title: "Noise-cancelling headsets", category: "PERIPHERAL", quantity: 4, unitPrice: "189.00",
    justification: "The open-plan support area is too loud for customer calls.",
    neededBy: "2026-12-15",
    steps: [],
  },
  {
    requester: "jordan", title: "Lab network switch", category: "NETWORKING", quantity: 1, unitPrice: "1240.00",
    justification: "The test lab needs an isolated network segment for load testing.",
    neededBy: "2026-11-15",
    steps: [["morgan", "APPROVE"], ["taylor", "REJECT", "Networking budget is frozen this quarter. Please resubmit in January."]],
  },
  {
    requester: "avery", title: "Spare docking stations", category: "PERIPHERAL", quantity: 3, unitPrice: "215.00",
    justification: "Hot desks need docking stations for visiting team members.",
    neededBy: "2026-11-10",
    steps: [["avery", "WITHDRAW", "Found three unused docks in storage."]],
  },
  {
    requester: "morgan", title: "Conference room camera", category: "PERIPHERAL", quantity: 1, unitPrice: "699.00",
    justification: "Remote participants cannot see the whiteboard in the main meeting room.",
    neededBy: "2026-12-01",
    steps: [],
  },
  {
    requester: "jordan", title: "Rugged tablets for the field team", category: "MOBILE_DEVICE", quantity: 5, unitPrice: "540.00",
    justification: "Field inspections are still recorded on paper and re-typed later.",
    neededBy: "2026-12-10",
    steps: [["morgan", "APPROVE", "Strong case; saves re-typing effort."]],
  },
  {
    requester: "avery", title: "Ergonomic keyboards", category: "PERIPHERAL", quantity: 6, unitPrice: "89.50",
    justification: "Several team members reported wrist strain with the standard keyboards.",
    neededBy: "2026-11-25",
    steps: [["riley", "REJECT", "Please merge this into the quarterly peripherals order instead."]],
  },
  {
    requester: "jordan", title: "Portable projector", category: "OTHER", quantity: 1, unitPrice: "780.00",
    justification: "Workshops at partner sites have no reliable projector available.",
    neededBy: "2026-11-05",
    steps: [["riley", "APPROVE"], ["taylor", "APPROVE"], ["casey", "APPROVE"]],
  },
];

/**
 * Create the demo users and sample requests. Timestamps come from a stepping clock starting
 * at a fixed date, so the seeded history is identical on every run.
 */
export function seedDemoData(db: Database, password = DEMO_PASSWORD): void {
  seedUsers(db, password);
  const clock = steppingClock("2026-10-05T09:00:00.000Z", 37 * 60_000);
  const service = new RequestService(db, clock);
  for (const sample of SAMPLE_REQUESTS) {
    const { requester, steps, ...input } = sample;
    let request = service.create(demoUser(requester), input);
    for (const [actor, action, comment] of steps) {
      clock.advance(19 * 60 * 60 * 1000);
      request = service.transition(demoUser(actor), request.id, action, { version: request.version, comment });
    }
    clock.advance(26 * 60 * 60 * 1000);
  }
}

export function isEmpty(db: Database): boolean {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n) === 0;
}
