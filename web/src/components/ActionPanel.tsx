// Decision controls. Buttons come from the server's allowedActions; the server still re-checks everything.

import { useState } from "react";
import type { Action } from "../../../shared/contracts.ts";

export const REJECT_REASON_MIN = 10;

const ACTION_COPY: Record<Action, { label: string; confirm: string; className: string; needsReason: boolean; placeholder: string }> = {
  APPROVE: {
    label: "Approve",
    confirm: "Confirm approval",
    className: "btn-primary",
    needsReason: false,
    placeholder: "Optional note for the next stage",
  },
  REJECT: {
    label: "Reject",
    confirm: "Confirm rejection",
    className: "btn-danger",
    needsReason: true,
    placeholder: "Explain why the request is rejected (at least 10 characters)",
  },
  WITHDRAW: {
    label: "Withdraw",
    confirm: "Confirm withdrawal",
    className: "btn-secondary",
    needsReason: false,
    placeholder: "Optional reason",
  },
};

interface Props {
  allowedActions: Action[];
  busy: boolean;
  onSubmit: (action: Action, comment: string) => void;
}

export function ActionPanel({ allowedActions, busy, onSubmit }: Props) {
  const [pending, setPending] = useState<Action | null>(null);
  const [comment, setComment] = useState("");

  if (allowedActions.length === 0) return null;
  const copy = pending ? ACTION_COPY[pending] : null;
  const reasonTooShort = copy?.needsReason === true && comment.trim().length < REJECT_REASON_MIN;

  return (
    <section className="card action-panel" aria-label="Decision">
      <h2>Your decision</h2>
      {!pending ? (
        <div className="button-row">
          {allowedActions.map((action) => (
            <button key={action} type="button" className={`btn ${ACTION_COPY[action].className}`} onClick={() => setPending(action)}>
              {ACTION_COPY[action].label}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="decision-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reasonTooShort) onSubmit(pending, comment.trim());
          }}
        >
          <label htmlFor="decision-comment">
            {copy?.needsReason ? "Reason (required)" : "Comment (optional)"}
          </label>
          <textarea
            id="decision-comment"
            rows={3}
            maxLength={1000}
            value={comment}
            placeholder={copy?.placeholder}
            onChange={(event) => setComment(event.target.value)}
            autoFocus
          />
          {copy?.needsReason ? (
            <p className="hint" aria-live="polite">
              {comment.trim().length}/{REJECT_REASON_MIN} characters minimum
            </p>
          ) : null}
          <div className="button-row">
            <button type="submit" className={`btn ${copy?.className ?? ""}`} disabled={busy || reasonTooShort}>
              {busy ? "Saving…" : copy?.confirm}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setPending(null);
                setComment("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
