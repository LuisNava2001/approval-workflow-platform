import type { ReactNode } from "react";

export function Alert({ tone = "critical", children }: { tone?: "critical" | "warning" | "good" | "info"; children: ReactNode }) {
  return (
    <div className={`alert tone-${tone}`} role={tone === "critical" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <p className="loading muted" role="status">
      {label}&hellip;
    </p>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <p className="muted">{children}</p> : null}
    </div>
  );
}
