import type { RequestStatus } from "../../../shared/contracts.ts";
import { STATUS_META } from "../format.ts";

export function StatusBadge({ status, large = false }: { status: RequestStatus; large?: boolean }) {
  const meta = STATUS_META[status];
  return (
    <span className={`badge tone-${meta.tone}${large ? " badge-lg" : ""}`} data-status={status}>
      <span className="badge-icon" aria-hidden="true">
        {meta.icon}
      </span>
      <span>{meta.label}</span>
    </span>
  );
}
