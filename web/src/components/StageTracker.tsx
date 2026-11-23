import { STAGES, type RequestEventDto, type RequestStatus } from "../../../shared/contracts.ts";
import { ROLE_LABELS, stageStates, type StageState } from "../format.ts";

const STATE_TEXT: Record<StageState, { text: string; icon: string }> = {
  done: { text: "Approved", icon: "✓" },
  current: { text: "Waiting for decision", icon: "◷" },
  upcoming: { text: "Not started", icon: "" },
  rejected: { text: "Rejected here", icon: "✕" },
  skipped: { text: "Not reached", icon: "–" },
};

export function StageTracker({ status, events }: { status: RequestStatus; events: RequestEventDto[] }) {
  const states = stageStates(status, events);
  return (
    <ol className="stages" aria-label="Approval stages">
      {STAGES.map((stage, index) => {
        const state = states[stage];
        const { text, icon } = STATE_TEXT[state];
        return (
          <li key={stage} className={`stage stage-${state}`} aria-current={state === "current" ? "step" : undefined}>
            <span className="stage-marker" aria-hidden="true">
              {icon || index + 1}
            </span>
            <span className="stage-body">
              <span className="stage-name">{ROLE_LABELS[stage]}</span>
              <span className="stage-state">{text}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
