// API contract shared by the server and the web client.
// Type-only declarations plus a few constant tuples; no runtime dependencies.

export const ROLES = ["REQUESTER", "MANAGER", "FINANCE", "OPERATIONS", "AUDITOR"] as const;
export type Role = (typeof ROLES)[number];

export const STATUSES = [
  "PENDING_MANAGER",
  "PENDING_FINANCE",
  "PENDING_OPERATIONS",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
] as const;
export type RequestStatus = (typeof STATUSES)[number];

export const ACTIONS = ["APPROVE", "REJECT", "WITHDRAW"] as const;
export type Action = (typeof ACTIONS)[number];

export const CATEGORIES = ["LAPTOP", "MONITOR", "PERIPHERAL", "MOBILE_DEVICE", "NETWORKING", "OTHER"] as const;
export type Category = (typeof CATEGORIES)[number];

export const EVENT_TYPES = ["SUBMITTED", "APPROVED", "REJECTED", "WITHDRAWN"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** The approval stages, in order. */
export const STAGES = ["MANAGER", "FINANCE", "OPERATIONS"] as const satisfies readonly Role[];
export type StageRole = (typeof STAGES)[number];

export interface UserDto {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

export interface PersonRef {
  id: string;
  displayName: string;
}

export interface RequestSummaryDto {
  id: number;
  reference: string;
  title: string;
  category: Category;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  currency: "USD";
  status: RequestStatus;
  currentStage: StageRole | null;
  requester: PersonRef;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface RequestEventDto {
  sequence: number;
  type: EventType;
  actor: PersonRef & { role: Role };
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus;
  comment: string | null;
  createdAt: string;
}

export interface RequestDetailDto extends RequestSummaryDto {
  justification: string;
  neededBy: string;
  events: RequestEventDto[];
  /** Actions the current user may perform now, computed by the server's policy. */
  allowedActions: Action[];
}

export interface ActivityDto extends RequestEventDto {
  requestId: number;
  reference: string;
  title: string;
}

export interface DashboardDto {
  counts: Record<RequestStatus, number>;
  awaitingMe: RequestSummaryDto[];
  myOpen: RequestSummaryDto[];
  openTotalCents: number;
  approvedTotalCents: number;
  averageCycleHours: number | null;
  recentActivity: ActivityDto[];
}

export interface NewRequestInput {
  title: string;
  category: Category;
  quantity: number;
  /** Decimal string with up to two decimals, e.g. "1299.00". */
  unitPrice: string;
  justification: string;
  /** ISO date, YYYY-MM-DD. */
  neededBy: string;
}

export interface TransitionInput {
  /** The version the client last saw; stale versions are rejected with 409. */
  version: number;
  /** Required for REJECT (at least 10 characters), optional otherwise. */
  comment?: string;
}

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "INVALID_CREDENTIALS"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "SERVICE_BUSY"
  | "INTERNAL";

export interface FieldError {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: FieldError[];
  };
}
