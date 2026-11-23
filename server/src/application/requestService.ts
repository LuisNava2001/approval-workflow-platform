// Use cases for purchase requests: create, list, read, transition and the dashboard.
// Every write runs in one transaction that updates the request and appends its audit event.

import {
  STATUSES,
  type Action,
  type ActivityDto,
  type DashboardDto,
  type RequestDetailDto,
  type RequestEventDto,
  type RequestStatus,
  type RequestSummaryDto,
  type Role,
  type UserDto,
} from "../../../shared/contracts.ts";
import { allowedActions, authorize, canCreate, canView, type RequestFacts } from "../domain/policy.ts";
import { EVENT_FOR_ACTION, INITIAL_STATUS, isTerminal, nextStatus, stageRole } from "../domain/stateMachine.ts";
import { validateNewRequest, validateTransition } from "../domain/validation.ts";
import { withTransaction, type Database } from "../infrastructure/db.ts";
import { isoDate, type Clock } from "./clock.ts";
import { badRequest, conflict, forbidden, invalidTransition, notFound, validationFailed } from "./errors.ts";

interface RequestRow {
  id: number;
  title: string;
  category: RequestSummaryDto["category"];
  quantity: number;
  unit_price_cents: number;
  justification: string;
  needed_by: string;
  status: RequestStatus;
  requester_id: string;
  requester_name: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  request_id: number;
  sequence: number;
  type: RequestEventDto["type"];
  actor_id: string;
  actor_name: string;
  actor_role: Role;
  from_status: RequestStatus | null;
  to_status: RequestStatus;
  comment: string | null;
  created_at: string;
  title?: string;
}

export type ListScope = "all" | "mine" | "awaiting";

export interface ListFilters {
  status?: string | null;
  scope?: string | null;
  q?: string | null;
}

const SELECT_REQUEST = `
  SELECT r.*, u.display_name AS requester_name
  FROM requests r JOIN users u ON u.id = r.requester_id`;

const SELECT_EVENT = `
  SELECT e.*, u.display_name AS actor_name
  FROM request_events e JOIN users u ON u.id = e.actor_id`;

export const reference = (id: number) => `REQ-${String(id).padStart(4, "0")}`;

const facts = (row: RequestRow): RequestFacts => ({ status: row.status, requesterId: row.requester_id });

function toSummary(row: RequestRow): RequestSummaryDto {
  return {
    id: row.id,
    reference: reference(row.id),
    title: row.title,
    category: row.category,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    totalCents: row.unit_price_cents * row.quantity,
    currency: "USD",
    status: row.status,
    currentStage: stageRole(row.status),
    requester: { id: row.requester_id, displayName: row.requester_name },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function toEvent(row: EventRow): RequestEventDto {
  return {
    sequence: row.sequence,
    type: row.type,
    actor: { id: row.actor_id, displayName: row.actor_name, role: row.actor_role },
    fromStatus: row.from_status,
    toStatus: row.to_status,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

export class RequestService {
  private readonly db: Database;
  private readonly clock: Clock;

  constructor(db: Database, clock: Clock) {
    this.db = db;
    this.clock = clock;
  }

  create(actor: UserDto, input: unknown): RequestDetailDto {
    if (!canCreate(actor)) throw forbidden("Auditors have read-only access and cannot submit requests.");
    const result = validateNewRequest(input, isoDate(this.clock.now()));
    if (!result.ok) throw validationFailed(result.errors);
    const value = result.value;
    const now = this.clock.now().toISOString();
    const id = withTransaction(this.db, () => {
      const info = this.db
        .prepare(
          `INSERT INTO requests (title, category, quantity, unit_price_cents, justification, needed_by,
                                 status, requester_id, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(value.title, value.category, value.quantity, value.unitPriceCents, value.justification, value.neededBy,
          INITIAL_STATUS, actor.id, now, now);
      const requestId = Number(info.lastInsertRowid);
      this.appendEvent(requestId, 1, "SUBMITTED", actor, null, INITIAL_STATUS, null, now);
      return requestId;
    });
    return this.get(actor, id);
  }

  list(actor: UserDto, filters: ListFilters = {}): RequestSummaryDto[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (actor.role === "REQUESTER") {
      where.push("r.requester_id = ?");
      params.push(actor.id);
    }
    const scope = (filters.scope ?? "all") as ListScope;
    if (!["all", "mine", "awaiting"].includes(scope)) throw badRequest("scope must be all, mine or awaiting.");
    if (scope === "mine") {
      where.push("r.requester_id = ?");
      params.push(actor.id);
    } else if (scope === "awaiting") {
      const status = this.awaitingStatus(actor);
      if (status === null) return [];
      where.push("r.status = ?", "r.requester_id <> ?");
      params.push(status, actor.id);
    }
    if (filters.status) {
      if (!(STATUSES as readonly string[]).includes(filters.status)) throw badRequest("Unknown status filter.");
      where.push("r.status = ?");
      params.push(filters.status);
    }
    if (filters.q && filters.q.trim()) {
      const pattern = `%${filters.q.trim().slice(0, 80).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      where.push("(r.title LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern);
    }
    const sql = `${SELECT_REQUEST} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                 ORDER BY r.updated_at DESC, r.id DESC LIMIT 200`;
    const rows = this.db.prepare(sql).all(...params) as unknown as RequestRow[];
    return rows.map(toSummary);
  }

  get(actor: UserDto, id: number): RequestDetailDto {
    const row = this.findVisible(actor, id);
    const events = this.db
      .prepare(`${SELECT_EVENT} WHERE e.request_id = ? ORDER BY e.sequence`)
      .all(id) as unknown as EventRow[];
    return {
      ...toSummary(row),
      justification: row.justification,
      neededBy: row.needed_by,
      events: events.map(toEvent),
      allowedActions: allowedActions(actor, facts(row)),
    };
  }

  /**
   * Apply an action. Order of checks: input, visibility (404), version (409 CONFLICT),
   * policy (403 / 409 INVALID_TRANSITION). The UPDATE is guarded by the version as well,
   * so a concurrent writer on another connection cannot cause a lost update.
   */
  transition(actor: UserDto, id: number, action: Action, input: unknown): RequestDetailDto {
    const parsed = validateTransition(input, action);
    if (!parsed.ok) throw validationFailed(parsed.errors);
    const { version, comment } = parsed.value;

    withTransaction(this.db, () => {
      const row = this.findVisible(actor, id);
      if (row.version !== version) {
        throw conflict(`This request changed since you loaded it (now version ${row.version}). Reload and try again.`);
      }
      const decision = authorize(actor, facts(row), action);
      if (!decision.allowed) {
        throw decision.code === "FORBIDDEN" ? forbidden(decision.reason) : invalidTransition(decision.reason);
      }
      const target = nextStatus(row.status, action) as RequestStatus;
      const now = this.clock.now().toISOString();
      const update = this.db
        .prepare("UPDATE requests SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
        .run(target, now, id, version);
      if (Number(update.changes) !== 1) throw conflict("This request was changed by someone else. Reload and try again.");
      this.appendEvent(id, version + 1, EVENT_FOR_ACTION[action], actor, row.status, target, comment, now);
    });
    return this.get(actor, id);
  }

  dashboard(actor: UserDto): DashboardDto {
    const visible = this.list(actor);
    const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<RequestStatus, number>;
    let openTotalCents = 0;
    let approvedTotalCents = 0;
    for (const request of visible) {
      counts[request.status] += 1;
      if (!isTerminal(request.status)) openTotalCents += request.totalCents;
      if (request.status === "APPROVED") approvedTotalCents += request.totalCents;
    }
    const awaitingMe = this.list(actor, { scope: "awaiting" });
    const myOpen = this.list(actor, { scope: "mine" }).filter((request) => !isTerminal(request.status));
    return {
      counts,
      awaitingMe,
      myOpen,
      openTotalCents,
      approvedTotalCents,
      averageCycleHours: this.averageCycleHours(visible),
      recentActivity: this.recentActivity(actor),
    };
  }

  private findVisible(actor: UserDto, id: number): RequestRow {
    if (!Number.isSafeInteger(id) || id < 1) throw notFound("Request not found.");
    const row = this.db.prepare(`${SELECT_REQUEST} WHERE r.id = ?`).get(id) as RequestRow | undefined;
    // Invisible and missing look identical, so the API does not reveal which requests exist.
    if (!row || !canView(actor, facts(row))) throw notFound("Request not found.");
    return row;
  }

  private awaitingStatus(actor: UserDto): RequestStatus | null {
    const pending: Partial<Record<Role, RequestStatus>> = {
      MANAGER: "PENDING_MANAGER",
      FINANCE: "PENDING_FINANCE",
      OPERATIONS: "PENDING_OPERATIONS",
    };
    return pending[actor.role] ?? null;
  }

  private appendEvent(
    requestId: number,
    sequence: number,
    type: RequestEventDto["type"],
    actor: UserDto,
    fromStatus: RequestStatus | null,
    toStatus: RequestStatus,
    comment: string | null,
    createdAt: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO request_events (request_id, sequence, type, actor_id, actor_role, from_status, to_status, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(requestId, sequence, type, actor.id, actor.role, fromStatus, toStatus, comment, createdAt);
  }

  private averageCycleHours(visible: RequestSummaryDto[]): number | null {
    const decided = visible.filter((request) => request.status === "APPROVED" || request.status === "REJECTED");
    if (decided.length === 0) return null;
    const totalMs = decided.reduce(
      (sum, request) => sum + (new Date(request.updatedAt).getTime() - new Date(request.createdAt).getTime()),
      0,
    );
    return Math.round((totalMs / decided.length / 3_600_000) * 10) / 10;
  }

  private recentActivity(actor: UserDto): ActivityDto[] {
    const ownOnly = actor.role === "REQUESTER";
    const rows = this.db
      .prepare(
        `SELECT e.*, u.display_name AS actor_name, r.title AS title
         FROM request_events e
         JOIN users u ON u.id = e.actor_id
         JOIN requests r ON r.id = e.request_id
         ${ownOnly ? "WHERE r.requester_id = ?" : ""}
         ORDER BY e.created_at DESC, e.id DESC LIMIT 10`,
      )
      .all(...(ownOnly ? [actor.id] : [])) as unknown as EventRow[];
    return rows.map((row) => ({
      ...toEvent(row),
      requestId: row.request_id,
      reference: reference(row.request_id),
      title: row.title ?? "",
    }));
  }
}
