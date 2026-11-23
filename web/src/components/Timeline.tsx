import type { RequestEventDto } from "../../../shared/contracts.ts";
import { EVENT_LABELS, formatDateTime, ROLE_LABELS, STATUS_META } from "../format.ts";

const EVENT_TONE: Record<RequestEventDto["type"], string> = {
  SUBMITTED: "info",
  APPROVED: "good",
  REJECTED: "critical",
  WITHDRAWN: "neutral",
};

export function Timeline({ events }: { events: RequestEventDto[] }) {
  return (
    <ol className="timeline">
      {events.map((event) => (
        <li key={event.sequence} className={`event tone-${EVENT_TONE[event.type]}`}>
          <span className="event-dot" aria-hidden="true" />
          <div className="event-body">
            <div className="event-head">
              <strong>{EVENT_LABELS[event.type]}</strong>
              <span className="muted">
                by {event.actor.displayName} ({ROLE_LABELS[event.actor.role]})
              </span>
            </div>
            <div className="event-meta muted">
              <span>{formatDateTime(event.createdAt)}</span>
              <span>
                {event.fromStatus ? `${STATUS_META[event.fromStatus].label} → ` : ""}
                {STATUS_META[event.toStatus].label}
              </span>
              <span>#{event.sequence}</span>
            </div>
            {event.comment ? <p className="event-comment">{event.comment}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
