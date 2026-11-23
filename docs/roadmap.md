# Limitations and roadmap

## Limitations

- **Demo authentication.** Seeded fictional identities share one documented password. There is no identity
  provider, MFA, password policy or login rate limiting.
- **Fixed approval chain.** Every request goes through Manager, Finance and Operations; there are no
  amount-based routes, delegations or deadlines.
- **No notifications.** Approvers discover work through the dashboard; there is no email or chat integration.
- **Single process, single SQLite file.** Suitable for a demo or a small team. Horizontal scaling would need a
  client-server database and shared session storage.
- **No file attachments** (quotes, invoices) on requests.
- **Times in UTC** in the UI; no per-user time zone.
- **Not tested** on macOS or browsers other than Chrome; Node.js 24 and Linux are covered by CI only.

## Roadmap

None of the following is implemented.

1. **Identity provider.** OpenID Connect sign-in with roles from group claims; keep the demo identities as a mode.
2. **Configurable routing.** Approval chains defined as data, for example an extra stage above an amount threshold.
3. **Notifications.** An outbox table written in the same transaction as each decision, drained by a worker that
   sends email or chat messages.
4. **Attachments.** Quotes stored outside the database with content hashes recorded in the audit trail.
5. **Hardening.** Login rate limiting, session listing and revocation, audit-log export.
6. **Observability.** Structured JSON logs with request IDs and basic metrics (decision time, queue sizes).
7. **End-to-end tests in CI.** Run the browser smoke test (or Playwright) in GitHub Actions.
