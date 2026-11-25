# Testing

```bash
npm test            # server (node --test) + web (Vitest)
npm run typecheck   # strict TypeScript for server and web
npm run verify      # typecheck + tests + production build
```

At the time of writing (2026-11-25): **60 server tests** and **25 web tests**, all passing locally on Windows with
Node.js 26.12.1. No test needs network access, credentials or external services.

## Server (`server/test`, Node's built-in test runner)

| Suite | What it proves |
|---|---|
| `domain.test.ts` | Transition table, terminal states, stage roles; authorization matrix for every role, status and action; separation of duties; validation of every field; money parsing |
| `requestService.test.ts` | Create, full three-stage approval with audit trail, mandatory rejection reason, forbidden actions, owner-only withdrawal, `404` visibility, list scopes and filters, search escaping, dashboard scoping |
| `integrity.test.ts` | Append-only audit triggers; `CHECK` and foreign-key enforcement; status change rolled back when the audit insert fails; stale-version `409`; lost-update prevention across two connections; `503 SERVICE_BUSY` under a held write lock; 400-step randomized invariant walk; persistence across reopen; full rollback of failed transactions |
| `api.test.ts` | Over real HTTP: cookie attributes, generic login errors, login validation, session probe, `401` on every protected route and for forged cookies, server-side logout; `403`/`404` authorization negatives; full approval flow and `allowedActions` per user; five concurrent approvals with exactly one winner; `415`/`400`/`413`/`404`/`405` handling; security headers; demo identities only in demo mode; demo password refused outside demo mode with the same error as a wrong password |
| `seed.test.ts` | Seed covers every status with valid histories, is deterministic, every identity can sign in; outside demo mode only the shared demo password is refused; sessions expire |

Tests use in-memory databases or temporary files, a stepping clock and a deterministic random generator, so
results do not depend on the current date or on test order.

## Web (`web/test`, Vitest + Testing Library + jsdom)

| Suite | What it proves |
|---|---|
| `format.test.ts` | Money and date formatting, stage states for pending, rejected and approved requests, hash routing |
| `api.test.ts` | Same-origin JSON requests, `ApiError` with field details, session-expiry hook on `401`, query building, non-JSON error pages |
| `components.test.tsx` | Status badges pair color with icon and label; stage tracker marks the current step; action panel shows only allowed actions and requires a rejection reason; login with demo identities and error display; with demo mode off (or unconfirmed) the login page shows no demo password and no identities |
| `detail.test.ts` | Status notes, including the separation-of-duties explanation |
| `detailPage.test.tsx` | A `409 CONFLICT` on approval shows the server's message and a reload button; the request body carries the version |

## Browser smoke test (optional, not in CI)

`scripts/browser-smoke.mjs` drives a real Chrome through the DevTools Protocol against a running server:
UI sign-in, separation-of-duties display, rejection-reason gating, an approval through the UI, no horizontal
overflow at 390 px, and no console errors or CSP violations. It needs a freshly seeded database:

```bash
npm run seed && npm run build && npm start              # terminal 1
npm run smoke:browser                                   # terminal 2 (set CHROME_PATH if needed)
```

All 9 checks passed locally with Chrome on Windows.

## Continuous integration

`.github/workflows/ci.yml` runs `npm ci`, the typecheck, both test suites and the production build on Ubuntu and
Windows with Node.js 24 and 26 (four jobs). The browser smoke test is not part of CI.

## Not tested

- Node.js 24 and Linux are exercised by CI only; local runs used Windows with Node.js 26.12.1.
- macOS, browsers other than Chrome, screen readers, and load or performance behavior.
