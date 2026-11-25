# REST API

Base path `/api`. Request and response bodies are JSON. Write requests with a body must send
`Content-Type: application/json` (otherwise `415`). Bodies are limited to 32 KB (`413`).
Authentication is an `HttpOnly`, `SameSite=Strict` cookie named `awp_session`, set by the login endpoint.
Types are defined in [`shared/contracts.ts`](../shared/contracts.ts).

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | no | Liveness check: `{ "status": "ok" }` |
| GET | `/api/demo/identities` | no | Demo identities for the login screen (no credentials). `404` when `DEMO_MODE=false` |
| POST | `/api/auth/login` | no | `{ username, password }` → `{ user, expiresAt }` and the session cookie. With `DEMO_MODE=false` the demo password is refused (`401 INVALID_CREDENTIALS`) |
| POST | `/api/auth/logout` | no | Deletes the server-side session and clears the cookie (`204`) |
| GET | `/api/auth/session` | no | `{ user }` or `{ user: null }`; used by the UI at startup |
| GET | `/api/auth/me` | yes | `{ user }`; `401` without a valid session |
| GET | `/api/requests` | yes | `{ requests }` visible to the caller. Query: `scope=all\|mine\|awaiting`, `status`, `q` |
| POST | `/api/requests` | yes | Create a request (`201 { request }`) |
| GET | `/api/requests/:id` | yes | `{ request }` with `events` and `allowedActions` |
| POST | `/api/requests/:id/approve` | yes | `{ version, comment? }` |
| POST | `/api/requests/:id/reject` | yes | `{ version, comment }` with a reason of at least 10 characters |
| POST | `/api/requests/:id/withdraw` | yes | `{ version, comment? }` |
| GET | `/api/dashboard` | yes | Counts, queues, totals, average decision time and recent activity for the caller |

## Create a request

```http
POST /api/requests
Content-Type: application/json

{
  "title": "Noise-cancelling headsets",
  "category": "PERIPHERAL",
  "quantity": 4,
  "unitPrice": "189.00",
  "justification": "The open-plan support area is too loud for customer calls.",
  "neededBy": "2026-12-15"
}
```

`unitPrice` is a decimal string (never a float); the server stores integer cents. Categories:
`LAPTOP`, `MONITOR`, `PERIPHERAL`, `MOBILE_DEVICE`, `NETWORKING`, `OTHER`. The total may not exceed 1,000,000.00 and
`neededBy` may not be in the past. Unknown fields are rejected.

## Errors

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request contains invalid fields.",
    "details": [{ "field": "comment", "message": "A rejection needs a reason of at least 10 characters." }]
  }
}
```

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed JSON, unknown filter value |
| 401 | `UNAUTHENTICATED` | Missing, unknown or expired session |
| 401 | `INVALID_CREDENTIALS` | Wrong username or password (same message for both) |
| 403 | `FORBIDDEN` | Wrong role for the stage, self-approval, auditor writing, non-owner withdrawing |
| 404 | `NOT_FOUND` | Unknown route or request, or a request the caller may not see |
| 405 | `METHOD_NOT_ALLOWED` | Known path, wrong method |
| 409 | `CONFLICT` | Stale `version`: the request changed since the client loaded it |
| 409 | `INVALID_TRANSITION` | The action does not exist from the current status |
| 413 | `PAYLOAD_TOO_LARGE` | Body above 32 KB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Body sent without `application/json` |
| 422 | `VALIDATION_FAILED` | Field errors, all reported at once in `details` |
| 503 | `SERVICE_BUSY` | Another connection held the database write lock beyond the busy timeout |
| 500 | `INTERNAL` | Unexpected error; details are logged server-side only |
