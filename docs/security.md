# Security model

This is a local demonstration with fictional identities. The controls below are implemented and tested; the
gaps at the end are what a production deployment would still need.

## Implemented

**Authentication (demo)**
- Passwords are hashed with scrypt (N=16384, r=8, p=1, 16-byte random salt) from `node:crypto`.
- Unknown usernames are verified against a dummy hash, so both failure paths cost one scrypt call and return
  the same `INVALID_CREDENTIALS` message.
- Sessions are 32 random bytes; only their SHA-256 digest is stored, so a copy of the database does not contain
  usable session tokens. Sessions expire after 8 hours and logout deletes the server-side row.

**Session cookie**
- `HttpOnly` (scripts cannot read it), `SameSite=Strict`, `Path=/`, `Max-Age` equal to the session lifetime.
- `Secure` is added when `COOKIE_SECURE=true`, for deployments behind HTTPS.

**Cross-site request forgery**
- `SameSite=Strict` keeps the cookie off cross-site requests.
- Bodies must be `application/json`, a content type that plain HTML forms cannot send cross-site.

**Authorization**
- Server-side policy for every read and write (see [workflow.md](workflow.md)): role per stage, separation of
  duties, owner-only withdrawal, read-only auditor, requester-scoped visibility returning `404`.

**Input handling**
- Strict validation with every error reported; unknown fields rejected; money as decimal strings and integer cents.
- 32 KB body limit; parameterized SQL everywhere; `LIKE` wildcards escaped in search.
- Database `CHECK` constraints and foreign keys as a second line of defense.

**Responses**
- API: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'`.
- Web pages: a strict CSP (`script-src 'self'`, `style-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`,
  `base-uri 'none'`). The browser smoke test checks that the built app runs without CSP violations.
- Unexpected errors return a generic message; stack traces are logged on the server only.
- The React client renders data as text; there is no `dangerouslySetInnerHTML`.

**Deployment defaults**
- Binds to `127.0.0.1` unless `HOST` is set. Static files are served with path containment.
- No secrets are required. The demo password is documented and applies only to seeded fictional identities.
- Dependencies were installed with `npm install --before=2026-11-09` (versions at least two weeks old) and are
  pinned by `package-lock.json`; `npm audit` reported no known vulnerabilities at install time.

## Not implemented

- Real identity provider (OIDC/SAML), multi-factor authentication or password policies.
- Rate limiting or lockout for login attempts.
- TLS termination (expected from a reverse proxy).
- Session rotation on privilege change, or listing and revoking sessions.
- Audit-log export, retention policy or tamper evidence beyond the append-only triggers.
- A security review by a third party.
