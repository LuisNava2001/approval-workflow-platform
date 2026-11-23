# Architecture

Everything described here exists in the current release. Planned work is listed only in [roadmap.md](roadmap.md).

## System overview

```mermaid
flowchart LR
    subgraph browser["Browser"]
        spa["React + TypeScript SPA<br/>hash routing, no state library"]
    end

    subgraph server["Node.js process (TypeScript, no framework)"]
        http["HTTP layer<br/>router, cookies, JSON limits,<br/>security headers, error mapping"]
        auth["AuthService<br/>scrypt passwords,<br/>hashed session tokens"]
        svc["RequestService<br/>use cases + transactions"]
        policy["Domain<br/>state machine, policy,<br/>validation, money"]
        static["Static file server<br/>web/dist with CSP"]
    end

    db[("SQLite via node:sqlite<br/>CHECK, FK, append-only trigger")]

    spa -- "REST + HttpOnly session cookie" --> http
    spa -- "GET /, /assets/*" --> static
    http --> auth
    http --> svc
    svc --> policy
    auth --> db
    svc --> db
```

One process serves both the API (`/api/*`) and the built client, so the browser talks to a single origin and the
session cookie can be `SameSite=Strict`. During development Vite serves the client and proxies `/api` to the API.

## Server layers

| Layer | Path | Responsibility |
|---|---|---|
| Contract | `shared/contracts.ts` | Roles, statuses, actions, DTOs and error codes shared with the client |
| Domain | `server/src/domain` | `stateMachine.ts` (transition table), `policy.ts` (authorization), `validation.ts`, `money.ts`. Pure functions, no I/O |
| Application | `server/src/application` | `RequestService` and `AuthService` use cases, typed `AppError`s, injectable `Clock` |
| Infrastructure | `server/src/infrastructure` | SQLite connection and migrations, scrypt hashing, synthetic seed data |
| HTTP | `server/src/http` | Router, request handling, static files |
| Composition | `server/src/composition.ts`, `main.ts` | Wiring from configuration and environment variables |

The server has **no runtime dependencies**: HTTP, SQLite (`node:sqlite`), hashing (`node:crypto`) and TypeScript
execution (type stripping) all come from Node.js itself.

## Data model

```mermaid
erDiagram
    users ||--o{ sessions : "has"
    users ||--o{ requests : "submits"
    users ||--o{ request_events : "acts in"
    requests ||--|{ request_events : "history"

    users {
        TEXT id PK
        TEXT username UK
        TEXT display_name
        TEXT role "CHECK in 5 roles"
        TEXT password_hash "scrypt"
    }
    sessions {
        TEXT token_hash PK "SHA-256 of the token"
        TEXT user_id FK
        TEXT expires_at
    }
    requests {
        INTEGER id PK
        TEXT title "CHECK 3-120 chars"
        TEXT category "CHECK in 6 values"
        INTEGER quantity "CHECK 1-100"
        INTEGER unit_price_cents "CHECK > 0"
        TEXT status "CHECK in 6 statuses"
        TEXT requester_id FK
        INTEGER version "optimistic concurrency"
    }
    request_events {
        INTEGER id PK
        INTEGER request_id FK
        INTEGER sequence "UNIQUE with request_id"
        TEXT type
        TEXT actor_id FK
        TEXT actor_role
        TEXT from_status
        TEXT to_status
        TEXT comment
    }
```

- Tables are `STRICT`; foreign keys are enforced (`PRAGMA foreign_keys = ON`).
- `request_events` is append-only: `BEFORE UPDATE` and `BEFORE DELETE` triggers abort any change.
- A request's `version` equals its number of events; the event `sequence` is the version it produced.
- Money is stored as integer cents; totals are computed, never stored.
- Schema changes are ordered migrations tracked in `PRAGMA user_version`.
- File databases use WAL mode and a 5-second busy timeout.

## Request lifecycle of a write

```mermaid
sequenceDiagram
    participant UI as React UI
    participant API as HTTP layer
    participant S as RequestService
    participant P as Policy
    participant DB as SQLite

    UI->>API: POST /api/requests/7/approve {version: 2}
    API->>API: JSON content type, size limit, session cookie
    API->>S: transition(user, 7, APPROVE, body)
    S->>S: validate body (422 on failure)
    S->>DB: BEGIN IMMEDIATE
    S->>DB: load request (404 if missing or not visible)
    S->>S: version check (409 CONFLICT if stale)
    S->>P: authorize(user, request, APPROVE)
    P-->>S: allowed, or 403 FORBIDDEN / 409 INVALID_TRANSITION
    S->>DB: UPDATE ... WHERE id = 7 AND version = 2
    S->>DB: INSERT request_events (sequence 3)
    S->>DB: COMMIT (ROLLBACK on any error)
    S-->>API: request detail + allowedActions
    API-->>UI: 200 JSON
```

## Web client

| Path | Responsibility |
|---|---|
| `web/src/api.ts` | Typed fetch client; turns error bodies into `ApiError` with field details |
| `web/src/auth.tsx` | Session context; probes `/api/auth/session` at startup |
| `web/src/router.ts` | Hash routing with `useSyncExternalStore` |
| `web/src/pages/*` | Login, dashboard, request list, request detail, new request |
| `web/src/components/*` | Status badge, stage tracker, action panel, timeline, feedback |

The client never decides what a user may do: the server returns `allowedActions` for each request, computed by the
same policy that guards the write endpoints.

## Repository layout

```
shared/        API contract and demo constants used by both sides
server/
  src/         domain, application, infrastructure, http, composition, main
  test/        node:test suites (unit, integration, integrity, concurrency, persistence)
web/
  src/         React application
  test/        Vitest + Testing Library suites
scripts/       browser-smoke.mjs (optional Chrome DevTools Protocol smoke test)
docs/          this documentation and screenshots
```
