import { useState } from "react";
import type { Action, RequestDetailDto, UserDto } from "../../../shared/contracts.ts";
import { api, ApiError } from "../api.ts";
import { ActionPanel } from "../components/ActionPanel.tsx";
import { Alert, Loading } from "../components/Feedback.tsx";
import { StageTracker } from "../components/StageTracker.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { Timeline } from "../components/Timeline.tsx";
import { CATEGORY_LABELS, formatDate, formatDateTime, formatMoney, ROLE_LABELS } from "../format.ts";
import { useAsync } from "../hooks.ts";

/** Explains why the user cannot approve or reject, or null when nothing needs explaining. */
export function statusNote(request: RequestDetailDto, user: UserDto): string | null {
  const stage = request.currentStage;
  if (stage === null) return "This request is closed. Its history below is final.";
  const isOwner = request.requester.id === user.id;
  if (isOwner && user.role === stage) {
    return `Separation of duties: another ${ROLE_LABELS[stage]} must approve or reject your own request.`;
  }
  if (request.allowedActions.includes("APPROVE")) return null;
  if (isOwner) return `Waiting for ${ROLE_LABELS[stage]} to decide.`;
  return `Waiting for ${ROLE_LABELS[stage]}. Your role cannot act at this stage.`;
}

export function RequestDetailPage({ id, user }: { id: number; user: UserDto }) {
  const state = useAsync(() => api.getRequest(id).then((result) => result.request), `request-${id}`);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "critical" | "warning"; text: string; reload?: boolean } | null>(null);
  const [override, setOverride] = useState<RequestDetailDto | null>(null);

  const request = override && override.id === id ? override : state.data;

  async function decide(action: Action, comment: string) {
    if (!request) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.transition(id, action, { version: request.version, ...(comment ? { comment } : {}) });
      setOverride(result.request);
      setMessage({ tone: "good", text: `Saved. The request is now ${result.request.status.replaceAll("_", " ").toLowerCase()}.` });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setMessage({ tone: "warning", text: error.message, reload: true });
      } else {
        setMessage({ tone: "critical", text: error instanceof Error ? error.message : "The decision could not be saved." });
      }
    } finally {
      setBusy(false);
    }
  }

  if (state.loading && !request) return <Loading label="Loading request" />;
  if (state.error && !request) {
    const notFound = state.error instanceof ApiError && state.error.status === 404;
    return <Alert>{notFound ? "This request does not exist or you do not have access to it." : state.error.message}</Alert>;
  }
  if (!request) return null;
  const note = statusNote(request, user);

  return (
    <div className="page">
      <a className="back" href="#/requests">
        &larr; All requests
      </a>
      <header className="page-head detail-head">
        <div>
          <p className="eyebrow">{request.reference}</p>
          <h1>{request.title}</h1>
        </div>
        <StatusBadge status={request.status} large />
      </header>

      {message ? (
        <Alert tone={message.tone}>
          {message.text}{" "}
          {message.reload ? (
            <button
              type="button"
              className="btn btn-ghost btn-inline"
              onClick={() => {
                setOverride(null);
                setMessage(null);
                state.reload();
              }}
            >
              Reload request
            </button>
          ) : null}
        </Alert>
      ) : null}

      <section className="card" aria-label="Approval progress">
        <StageTracker status={request.status} events={request.events} />
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="details-title">
          <h2 id="details-title">Details</h2>
          <dl className="facts">
            <dt>Category</dt>
            <dd>{CATEGORY_LABELS[request.category]}</dd>
            <dt>Quantity</dt>
            <dd>{request.quantity}</dd>
            <dt>Unit price</dt>
            <dd>{formatMoney(request.unitPriceCents)}</dd>
            <dt>Total</dt>
            <dd className="strong">{formatMoney(request.totalCents)}</dd>
            <dt>Needed by</dt>
            <dd>{formatDate(request.neededBy)}</dd>
            <dt>Requester</dt>
            <dd>{request.requester.displayName}</dd>
            <dt>Submitted</dt>
            <dd>{formatDateTime(request.createdAt)}</dd>
            <dt>Version</dt>
            <dd>{request.version}</dd>
          </dl>
          <h3>Justification</h3>
          <p className="justification">{request.justification}</p>
        </section>

        <div className="stack">
          <ActionPanel key={request.version} allowedActions={request.allowedActions} busy={busy} onSubmit={decide} />
          {note ? (
            <section className="card">
              <h2>Status</h2>
              <p className="muted">{note}</p>
            </section>
          ) : null}
          <section className="card" aria-labelledby="history-title">
            <h2 id="history-title">Audit history</h2>
            <Timeline events={request.events} />
          </section>
        </div>
      </div>
    </div>
  );
}
