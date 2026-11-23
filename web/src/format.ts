// Labels, status presentation and formatting helpers.

import {
  STAGES,
  type Category,
  type EventType,
  type RequestEventDto,
  type RequestStatus,
  type Role,
  type StageRole,
} from "../../shared/contracts.ts";

export type Tone = "info" | "good" | "critical" | "neutral" | "warning";

/** Status colors never stand alone: each status has an icon and a text label. */
export const STATUS_META: Record<RequestStatus, { label: string; tone: Tone; icon: string }> = {
  PENDING_MANAGER: { label: "Pending manager", tone: "info", icon: "◷" },
  PENDING_FINANCE: { label: "Pending finance", tone: "info", icon: "◷" },
  PENDING_OPERATIONS: { label: "Pending operations", tone: "info", icon: "◷" },
  APPROVED: { label: "Approved", tone: "good", icon: "✓" },
  REJECTED: { label: "Rejected", tone: "critical", icon: "✕" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral", icon: "↩" },
};

export const ROLE_LABELS: Record<Role, string> = {
  REQUESTER: "Requester",
  MANAGER: "Manager",
  FINANCE: "Finance",
  OPERATIONS: "Operations",
  AUDITOR: "Auditor (read-only)",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  LAPTOP: "Laptop",
  MONITOR: "Monitor",
  PERIPHERAL: "Peripheral",
  MOBILE_DEVICE: "Mobile device",
  NETWORKING: "Networking",
  OTHER: "Other",
};

export const EVENT_LABELS: Record<EventType, string> = {
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export const formatMoney = (cents: number) => money.format(cents / 100);
export const formatDate = (iso: string) => date.format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
export const formatDateTime = (iso: string) => `${dateTime.format(new Date(iso))} UTC`;

export function formatHours(hours: number | null): string {
  if (hours === null) return "No decisions yet";
  return hours >= 48 ? `${(hours / 24).toFixed(1)} days` : `${hours.toFixed(1)} h`;
}

export type StageState = "done" | "current" | "upcoming" | "rejected" | "skipped";

/** Where each approval stage stands, derived from the status and the audit trail. */
export function stageStates(status: RequestStatus, events: RequestEventDto[]): Record<StageRole, StageState> {
  const states = {} as Record<StageRole, StageState>;
  for (const stage of STAGES) {
    if (events.some((event) => event.type === "APPROVED" && event.actor.role === stage)) states[stage] = "done";
    else if (events.some((event) => event.type === "REJECTED" && event.actor.role === stage)) states[stage] = "rejected";
    else if (status === `PENDING_${stage}`) states[stage] = "current";
    else if (status === "REJECTED" || status === "WITHDRAWN") states[stage] = "skipped";
    else states[stage] = "upcoming";
  }
  return states;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
