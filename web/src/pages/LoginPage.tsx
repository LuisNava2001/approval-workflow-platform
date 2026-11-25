import { useState, type FormEvent } from "react";
import { ROLES, type UserDto } from "../../../shared/contracts.ts";
import { DEMO_PASSWORD } from "../../../shared/demo.ts";
import { api, ApiError } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { Alert, Loading } from "../components/Feedback.tsx";
import { ROLE_LABELS } from "../format.ts";
import { useAsync } from "../hooks.ts";

const ROLE_BLURB: Record<UserDto["role"], string> = {
  REQUESTER: "Submits equipment requests",
  MANAGER: "First approval stage",
  FINANCE: "Second approval stage",
  OPERATIONS: "Final approval stage",
  AUDITOR: "Reads everything, changes nothing",
};

export function LoginPage() {
  const { login } = useAuth();
  const identities = useAsync(() => api.identities().then((result) => result.identities), "identities");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(name: string, secret: string) {
    setBusy(true);
    setError(null);
    try {
      await login(name, secret);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void signIn(username.trim(), password);
  }

  const sorted = [...(identities.data ?? [])].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
  // The server is the authority on demo mode: it lists demo identities only when DEMO_MODE is on, answers 404
  // otherwise, and then refuses the demo password. The page offers that password only after the server listed them.
  const demoMode = identities.data !== null;
  const demoOff = identities.error instanceof ApiError && identities.error.status === 404;

  return (
    <main className="login">
      <header className="login-head">
        <p className="eyebrow">Approval Workflow Platform</p>
        <h1>{demoMode ? "Sign in with a demo identity" : "Sign in"}</h1>
        {demoMode ? (
          <p className="muted">
            Every person and request here is fictional. Pick an identity to explore the workflow from that role, or use
            the form with the demo password <code>{DEMO_PASSWORD}</code>.
          </p>
        ) : null}
        {demoOff ? (
          <p className="muted">Demo mode is turned off on this server: the demo identities and the demo password are disabled.</p>
        ) : null}
      </header>

      {error ? <Alert>{error}</Alert> : null}

      <section aria-label="Demo identities" className="identity-grid">
        {identities.loading ? <Loading label="Loading identities" /> : null}
        {identities.error && !demoOff ? <Alert tone="warning">Demo identities are unavailable. Use the form below.</Alert> : null}
        {sorted.map((identity) => (
          <button
            key={identity.id}
            type="button"
            className="identity"
            disabled={busy}
            onClick={() => void signIn(identity.username, DEMO_PASSWORD)}
          >
            <span className="identity-name">{identity.displayName}</span>
            <span className={`role-chip role-${identity.role.toLowerCase()}`}>{ROLE_LABELS[identity.role]}</span>
            <span className="identity-blurb muted">{ROLE_BLURB[identity.role]}</span>
            <span className="identity-action">Sign in as {identity.displayName.split(" ")[0]}</span>
          </button>
        ))}
      </section>

      <form className="card login-form" onSubmit={onSubmit} aria-label="Sign in with a username">
        <h2>{demoMode ? "Or sign in manually" : "Sign in with a username"}</h2>
        <label htmlFor="username">Username</label>
        <input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !username.trim() || !password}>
          Sign in
        </button>
      </form>
    </main>
  );
}
