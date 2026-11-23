// The request lifecycle as data: three sequential approval stages and three terminal states.

import type { Action, EventType, RequestStatus, StageRole } from "../../../shared/contracts.ts";

export const INITIAL_STATUS: RequestStatus = "PENDING_MANAGER";

export const TRANSITIONS: Readonly<Record<RequestStatus, Readonly<Partial<Record<Action, RequestStatus>>>>> = {
  PENDING_MANAGER: { APPROVE: "PENDING_FINANCE", REJECT: "REJECTED", WITHDRAW: "WITHDRAWN" },
  PENDING_FINANCE: { APPROVE: "PENDING_OPERATIONS", REJECT: "REJECTED", WITHDRAW: "WITHDRAWN" },
  PENDING_OPERATIONS: { APPROVE: "APPROVED", REJECT: "REJECTED", WITHDRAW: "WITHDRAWN" },
  APPROVED: {},
  REJECTED: {},
  WITHDRAWN: {},
};

const STAGE_BY_STATUS: Readonly<Partial<Record<RequestStatus, StageRole>>> = {
  PENDING_MANAGER: "MANAGER",
  PENDING_FINANCE: "FINANCE",
  PENDING_OPERATIONS: "OPERATIONS",
};

export const EVENT_FOR_ACTION: Readonly<Record<Action, EventType>> = {
  APPROVE: "APPROVED",
  REJECT: "REJECTED",
  WITHDRAW: "WITHDRAWN",
};

/** The status an action leads to, or null when the transition does not exist. */
export function nextStatus(status: RequestStatus, action: Action): RequestStatus | null {
  return TRANSITIONS[status][action] ?? null;
}

export function isTerminal(status: RequestStatus): boolean {
  return Object.keys(TRANSITIONS[status]).length === 0;
}

/** The role that must act next, or null for terminal states. */
export function stageRole(status: RequestStatus): StageRole | null {
  return STAGE_BY_STATUS[status] ?? null;
}

/** The pending status in which a given approver role acts. */
export function statusForStage(role: StageRole): RequestStatus {
  const entry = Object.entries(STAGE_BY_STATUS).find(([, stage]) => stage === role);
  if (!entry) throw new Error(`no status for stage ${role}`);
  return entry[0] as RequestStatus;
}
