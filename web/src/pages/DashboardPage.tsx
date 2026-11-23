import { STATUSES, type DashboardDto, type RequestSummaryDto, type UserDto } from "../../../shared/contracts.ts";
import { api } from "../api.ts";
import { Alert, EmptyState, Loading } from "../components/Feedback.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { EVENT_LABELS, formatDateTime, formatHours, formatMoney, ROLE_LABELS, STATUS_META } from "../format.ts";
import { useAsync } from "../hooks.ts";

function Kpi({ label, value, detail, href }: { label: string; value: string; detail?: string; href?: string }) {
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {detail ? <span className="kpi-detail">{detail}</span> : null}
    </>
  );
  return href ? (
    <a className="kpi kpi-link" href={href}>
      {body}
    </a>
  ) : (
    <div className="kpi">{body}</div>
  );
}

function StatusOverview({ counts }: { counts: DashboardDto["counts"] }) {
  const max = Math.max(1, ...Object.values(counts));
  return (
    <section className="card" aria-labelledby="status-overview">
      <h2 id="status-overview">Requests by status</h2>
      <ul className="bars">
        {STATUSES.map((status) => {
          const meta = STATUS_META[status];
          return (
            <li key={status}>
              <a className="bar-row" href={`#/requests?status=${status}`} title={`Show ${counts[status]} ${meta.label.toLowerCase()} request(s)`}>
                <span className="bar-label">{meta.label}</span>
                <span className="bar-track">
                  <span className={`bar-fill tone-${meta.tone}`} style={{ width: `${(counts[status] / max) * 100}%` }} />
                </span>
                <span className="bar-value">{counts[status]}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RequestTable({ requests, empty }: { requests: RequestSummaryDto[]; empty: string }) {
  if (requests.length === 0) return <EmptyState title={empty} />;
  return (
    <div className="table-wrap">
      <table className="data-table compact">
        <thead>
          <tr>
            <th scope="col">Request</th>
            <th scope="col">Requester</th>
            <th scope="col" className="num">
              Total
            </th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td data-label="Request">
                <a href={`#/requests/${request.id}`}>
                  <span className="ref">{request.reference}</span> {request.title}
                </a>
              </td>
              <td data-label="Requester">{request.requester.displayName}</td>
              <td data-label="Total" className="num">
                {formatMoney(request.totalCents)}
              </td>
              <td data-label="Status">
                <StatusBadge status={request.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DashboardPage({ user }: { user: UserDto }) {
  const state = useAsync(() => api.dashboard().then((result) => result.dashboard), `dashboard-${user.id}`);
  if (state.loading && !state.data) return <Loading label="Loading dashboard" />;
  if (state.error || !state.data) return <Alert>Could not load the dashboard. {state.error?.message}</Alert>;
  const dashboard = state.data;
  const counts = dashboard.counts;
  const open = counts.PENDING_MANAGER + counts.PENDING_FINANCE + counts.PENDING_OPERATIONS;
  const isApprover = user.role === "MANAGER" || user.role === "FINANCE" || user.role === "OPERATIONS";

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{ROLE_LABELS[user.role]}</p>
          <h1>Welcome, {user.displayName.split(" ")[0]}</h1>
        </div>
        {user.role !== "AUDITOR" ? (
          <a className="btn btn-primary" href="#/new">
            New request
          </a>
        ) : null}
      </header>

      <div className="kpis">
        {isApprover ? (
          <Kpi label="Awaiting your decision" value={String(dashboard.awaitingMe.length)} href="#/requests?scope=awaiting" detail="Open the queue" />
        ) : (
          <Kpi label="Your open requests" value={String(dashboard.myOpen.length)} href="#/requests?scope=mine" detail="View your requests" />
        )}
        <Kpi label="Open requests" value={String(open)} detail={`${formatMoney(dashboard.openTotalCents)} in progress`} href="#/requests" />
        <Kpi label="Approved" value={String(counts.APPROVED)} detail={formatMoney(dashboard.approvedTotalCents)} href="#/requests?status=APPROVED" />
        <Kpi label="Rejected" value={String(counts.REJECTED)} href="#/requests?status=REJECTED" />
        <Kpi label="Average decision time" value={formatHours(dashboard.averageCycleHours)} detail="Submission to final decision" />
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="queue-title">
          <h2 id="queue-title">{isApprover ? "Waiting for you" : "Your open requests"}</h2>
          <RequestTable
            requests={isApprover ? dashboard.awaitingMe : dashboard.myOpen}
            empty={isApprover ? "Nothing needs your decision right now." : "You have no open requests."}
          />
        </section>
        <StatusOverview counts={counts} />
      </div>

      <section className="card" aria-labelledby="activity-title">
        <h2 id="activity-title">Recent activity</h2>
        {dashboard.recentActivity.length === 0 ? (
          <EmptyState title="No activity yet." />
        ) : (
          <ul className="activity">
            {dashboard.recentActivity.map((event) => (
              <li key={`${event.requestId}-${event.sequence}`}>
                <span className={`activity-type tone-${event.type === "APPROVED" ? "good" : event.type === "REJECTED" ? "critical" : event.type === "WITHDRAWN" ? "neutral" : "info"}`}>
                  {EVENT_LABELS[event.type]}
                </span>
                <a href={`#/requests/${event.requestId}`}>
                  <span className="ref">{event.reference}</span> {event.title}
                </a>
                <span className="muted">
                  {event.actor.displayName} &middot; {formatDateTime(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
