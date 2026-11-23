// Typed client for the REST API. Errors arrive as ApiError with the server's code and field details.

import type {
  Action,
  ApiErrorBody,
  DashboardDto,
  ErrorCode,
  FieldError,
  NewRequestInput,
  RequestDetailDto,
  RequestSummaryDto,
  TransitionInput,
  UserDto,
} from "../../shared/contracts.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: FieldError[];

  constructor(status: number, code: ErrorCode, message: string, details: FieldError[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.map((detail) => [detail.field, detail.message]));
  }
}

let onUnauthorized: (() => void) | null = null;

/** Called when a protected request returns 401, for example after the session expired. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: { Accept: "application/json" } };
  if (body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;

  let data: unknown = null;
  const text = await response.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = (data as Partial<ApiErrorBody> | null)?.error;
    if (response.status === 401 && error?.code === "UNAUTHENTICATED") onUnauthorized?.();
    throw new ApiError(response.status, error?.code ?? "INTERNAL", error?.message ?? `Request failed (${response.status}).`, error?.details ?? []);
  }
  return data as T;
}

export interface ListParams {
  scope?: "all" | "mine" | "awaiting";
  status?: string;
  q?: string;
}

function query(params: ListParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const api = {
  identities: () => request<{ identities: UserDto[] }>("GET", "/api/demo/identities"),
  login: (username: string, password: string) => request<{ user: UserDto }>("POST", "/api/auth/login", { username, password }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  me: () => request<{ user: UserDto }>("GET", "/api/auth/me"),
  session: () => request<{ user: UserDto | null }>("GET", "/api/auth/session"),
  dashboard: () => request<{ dashboard: DashboardDto }>("GET", "/api/dashboard"),
  listRequests: (params: ListParams = {}) => request<{ requests: RequestSummaryDto[] }>("GET", `/api/requests${query(params)}`),
  getRequest: (id: number) => request<{ request: RequestDetailDto }>("GET", `/api/requests/${id}`),
  createRequest: (input: NewRequestInput) => request<{ request: RequestDetailDto }>("POST", "/api/requests", input),
  transition: (id: number, action: Action, input: TransitionInput) =>
    request<{ request: RequestDetailDto }>("POST", `/api/requests/${id}/${action.toLowerCase()}`, input),
};
