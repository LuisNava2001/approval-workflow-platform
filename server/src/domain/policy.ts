// Authorization policy. Pure functions: every allow/deny decision the API makes comes from here.

import { ACTIONS, type Action, type RequestStatus, type Role } from "../../../shared/contracts.ts";
import { nextStatus, stageRole } from "./stateMachine.ts";

export interface Actor {
  id: string;
  role: Role;
}

export interface RequestFacts {
  status: RequestStatus;
  requesterId: string;
}

export type Decision =
  | { allowed: true }
  | { allowed: false; code: "FORBIDDEN" | "INVALID_TRANSITION"; reason: string };

const ALLOW: Decision = { allowed: true };

/** Every role except the read-only auditor may submit requests. */
export function canCreate(actor: Actor): boolean {
  return actor.role !== "AUDITOR";
}

/** Requesters see only their own requests; approvers and auditors see all of them. */
export function canView(actor: Actor, request: RequestFacts): boolean {
  return actor.role !== "REQUESTER" || actor.id === request.requesterId;
}

export function authorize(actor: Actor, request: RequestFacts, action: Action): Decision {
  if (nextStatus(request.status, action) === null) {
    return { allowed: false, code: "INVALID_TRANSITION", reason: `Cannot ${action.toLowerCase()} a request in status ${request.status}.` };
  }
  const isOwner = actor.id === request.requesterId;
  if (action === "WITHDRAW") {
    return isOwner ? ALLOW : { allowed: false, code: "FORBIDDEN", reason: "Only the requester can withdraw a request." };
  }
  const stage = stageRole(request.status);
  if (actor.role !== stage) {
    return { allowed: false, code: "FORBIDDEN", reason: `This stage requires the ${stage} role.` };
  }
  if (isOwner) {
    return { allowed: false, code: "FORBIDDEN", reason: "Separation of duties: you cannot decide on your own request." };
  }
  return ALLOW;
}

export function allowedActions(actor: Actor, request: RequestFacts): Action[] {
  return ACTIONS.filter((action) => authorize(actor, request, action).allowed);
}
