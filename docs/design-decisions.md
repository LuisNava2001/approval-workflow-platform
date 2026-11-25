# Technical design decisions

## 1. The workflow is data, the policy is a pure function

Transitions live in one table and every allow/deny decision comes from `authorize()`. Both are pure, so the full
role × status × action matrix is unit-tested, and the server can return `allowedActions` computed by the exact
function that guards the write endpoints. The UI never re-implements the rules.

## 2. Optimistic concurrency with a version, enforced twice

Approvals are human decisions made on what the person saw. The client sends the version it saw; a stale version
is a `409 CONFLICT`, not a silent overwrite. The check runs inside `BEGIN IMMEDIATE` and the `UPDATE` repeats it in
its `WHERE` clause, which also protects against writers on other connections.

## 3. The audit trail is part of the write, and append-only for the application

- **Transactional integrity.** The status change, the version bump and the event are written in one
  `BEGIN IMMEDIATE` transaction. If the event insert fails, the status change is rolled back (tested), so one
  cannot exist without the other.
- **Application constraints.** The service only ever inserts events; no code path updates or deletes them.
- **Trigger protection.** `BEFORE UPDATE` and `BEFORE DELETE` triggers on `request_events` abort any change, so a
  bug or an ordinary `UPDATE`/`DELETE` against that table fails.
- **Limits.** The triggers are ordinary schema objects. Anyone with write access to the SQLite file can drop them,
  edit `requests` rows (which have no such trigger) or replace the file. There is no hash chain, signature or
  external copy, so the history is not cryptographically immutable and a direct edit would go undetected. Tamper
  evidence would need hashed or signed events, or a copy in append-only storage outside this database.

## 4. 404 instead of 403 for invisible requests

A requester probing other IDs learns nothing: missing and forbidden look identical. Approvers, who may see
everything, get precise `403` reasons when they cannot act.

## 5. Node.js built-ins instead of a framework and an ORM

`node:http`, `node:sqlite`, `node:crypto` and native TypeScript type stripping give a server with zero runtime
dependencies, no build step and nothing to patch. The cost is a small hand-written router and SQL by hand, both
easy to read at this size. A framework (Fastify, Express) or a query builder would be reasonable as the API grows.

## 6. Cookie sessions over bearer tokens

An `HttpOnly`, `SameSite=Strict` cookie keeps the token out of JavaScript's reach. Serving the client and API from
one origin makes the strict cookie practical; requiring JSON bodies closes the remaining form-post CSRF path.

## 7. Money as integer cents, prices as strings

The API accepts `"189.00"`, never `189.0`, and stores cents. No binary floating point touches an amount.

## 8. A shared contract file

`shared/contracts.ts` holds the roles, statuses, DTOs and error codes for both sides, type-checked in both
workspaces. Server responses and client expectations cannot drift silently.

## 9. Deterministic tests and seed data

The clock is injected, the randomized test uses a seeded generator, and seed data is created through the same
service as live data with a stepping clock. Seeded histories are identical on every run and obey every invariant.

## 10. Accessibility and honesty in the UI

Status colors always come with an icon and a label; the stage tracker uses `aria-current="step"`; tables turn into
cards on small screens; dark mode follows the system setting. Times are shown in UTC and labelled as such.
