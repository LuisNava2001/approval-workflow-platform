import { useState } from "react";
import { STATUSES, type UserDto } from "../../../shared/contracts.ts";
import { api, type ListParams } from "../api.ts";
import { Alert, EmptyState, Loading } from "../components/Feedback.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { CATEGORY_LABELS, formatDate, formatMoney, STATUS_META } from "../format.ts";
import { useAsync } from "../hooks.ts";
import { navigate } from "../router.ts";

const SCOPES: { value: NonNullable<ListParams["scope"]>; label: string }[] = [
  { value: "all", label: "All visible" },
  { value: "mine", label: "Mine" },
  { value: "awaiting", label: "Awaiting me" },
];

export function RequestsPage({ user, params }: { user: UserDto; params: URLSearchParams }) {
  const scope = (params.get("scope") as ListParams["scope"]) ?? "all";
  const status = params.get("status") ?? "";
  const [q, setQ] = useState(params.get("q") ?? "");
  const isApprover = user.role === "MANAGER" || user.role === "FINANCE" || user.role === "OPERATIONS";
  const scopes = SCOPES.filter((option) => option.value !== "awaiting" || isApprover).filter(
    (option) => option.value !== "mine" || user.role !== "AUDITOR",
  );

  const listParams: ListParams = { scope, ...(status ? { status } : {}), ...(params.get("q") ? { q: params.get("q") ?? "" } : {}) };
  const state = useAsync(() => api.listRequests(listParams).then((result) => result.requests), JSON.stringify(listParams));

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    navigate(`/requests?${next.toString()}`);
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Requests</p>
          <h1>Equipment requests</h1>
        </div>
        {user.role !== "AUDITOR" ? (
          <a className="btn btn-primary" href="#/new">
            New request
          </a>
        ) : null}
      </header>

      <div className="toolbar" role="search">
        <div className="segmented" role="tablist" aria-label="Scope">
          {scopes.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={scope === option.value}
              className={scope === option.value ? "active" : undefined}
              onClick={() => update({ scope: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="visually-hidden" htmlFor="status-filter">
          Status
        </label>
        <select id="status-filter" value={status} onChange={(event) => update({ status: event.target.value })}>
          <option value="">Any status</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_META[value].label}
            </option>
          ))}
        </select>
        <form
          className="search"
          onSubmit={(event) => {
            event.preventDefault();
            update({ q: q.trim() });
          }}
        >
          <label className="visually-hidden" htmlFor="search">
            Search title or requester
          </label>
          <input id="search" type="search" placeholder="Search title or requester" value={q} onChange={(event) => setQ(event.target.value)} />
          <button type="submit" className="btn btn-secondary">
            Search
          </button>
        </form>
      </div>

      {state.error ? <Alert>{state.error.message}</Alert> : null}
      {state.loading && !state.data ? <Loading label="Loading requests" /> : null}
      {state.data && state.data.length === 0 ? <EmptyState title="No requests match these filters." /> : null}
      {state.data && state.data.length > 0 ? (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Category</th>
                  <th scope="col">Requester</th>
                  <th scope="col" className="num">
                    Total
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {state.data.map((request) => (
                  <tr key={request.id}>
                    <td data-label="Request">
                      <a href={`#/requests/${request.id}`}>
                        <span className="ref">{request.reference}</span> {request.title}
                      </a>
                    </td>
                    <td data-label="Category">{CATEGORY_LABELS[request.category]}</td>
                    <td data-label="Requester">{request.requester.displayName}</td>
                    <td data-label="Total" className="num">
                      {formatMoney(request.totalCents)}
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={request.status} />
                    </td>
                    <td data-label="Updated">{formatDate(request.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="table-foot muted">{state.data.length} request(s)</p>
        </div>
      ) : null}
    </div>
  );
}
