import type { ReactNode } from "react";
import type { UserDto } from "../../shared/contracts.ts";
import { useAuth } from "./auth.tsx";
import { EmptyState, Loading } from "./components/Feedback.tsx";
import { ROLE_LABELS } from "./format.ts";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { NewRequestPage } from "./pages/NewRequestPage.tsx";
import { RequestDetailPage } from "./pages/RequestDetailPage.tsx";
import { RequestsPage } from "./pages/RequestsPage.tsx";
import { useRoute, type Route } from "./router.ts";

function Layout({ user, route, children }: { user: UserDto; route: Route; children: ReactNode }) {
  const { logout } = useAuth();
  const links = [
    { href: "#/dashboard", label: "Dashboard", active: route.name === "dashboard" },
    { href: "#/requests", label: "Requests", active: route.name === "requests" || route.name === "request" },
    ...(user.role !== "AUDITOR" ? [{ href: "#/new", label: "New request", active: route.name === "new" }] : []),
  ];
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/dashboard">
          <span className="brand-mark" aria-hidden="true">
            AW
          </span>
          <span className="brand-name">Approval Workflow</span>
        </a>
        <nav aria-label="Main">
          {links.map((link) => (
            <a key={link.href} href={link.href} aria-current={link.active ? "page" : undefined}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className="user">
          <span className="user-name">{user.displayName}</span>
          <span className={`role-chip role-${user.role.toLowerCase()}`}>{ROLE_LABELS[user.role]}</span>
          <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="content">{children}</main>
      <footer className="footer muted">Demo environment &middot; fictional identities and synthetic data only</footer>
    </div>
  );
}

function Page({ route, user }: { route: Route; user: UserDto }) {
  switch (route.name) {
    case "dashboard":
    case "login":
      return <DashboardPage user={user} />;
    case "requests":
      return <RequestsPage user={user} params={route.params} />;
    case "request":
      return <RequestDetailPage id={route.id} user={user} />;
    case "new":
      return user.role === "AUDITOR" ? <EmptyState title="Auditors have read-only access." /> : <NewRequestPage />;
    case "not-found":
      return <EmptyState title="Page not found.">Use the navigation above.</EmptyState>;
  }
}

export function App() {
  const route = useRoute();
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Checking your session" />;
  if (!user) return <LoginPage />;
  return (
    <Layout user={user} route={route}>
      <Page route={route} user={user} />
    </Layout>
  );
}
