// Input validation for the two write operations. Every problem is reported, not just the first.

import { CATEGORIES, type Action, type Category, type FieldError } from "../../../shared/contracts.ts";
import { parseMoneyToCents } from "./money.ts";

export const LIMITS = {
  titleMin: 3,
  titleMax: 120,
  justificationMin: 10,
  justificationMax: 1000,
  quantityMax: 100,
  totalMaxCents: 100_000_000, // 1,000,000.00
  commentMax: 1000,
  rejectReasonMin: 10,
} as const;

export interface ValidRequest {
  title: string;
  category: Category;
  quantity: number;
  unitPriceCents: number;
  justification: string;
  neededBy: string;
}

export interface ValidTransition {
  version: number;
  comment: string | null;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

const REQUEST_FIELDS = new Set(["title", "category", "quantity", "unitPrice", "justification", "neededBy"]);
const TRANSITION_FIELDS = new Set(["version", "comment"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownFields(input: Record<string, unknown>, allowed: Set<string>, errors: FieldError[]): void {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) errors.push({ field: key, message: "Unknown field." });
  }
}

function boundedText(input: Record<string, unknown>, field: string, min: number, max: number, errors: FieldError[]): string {
  const raw = input[field];
  const text = typeof raw === "string" ? raw.trim() : "";
  if (typeof raw !== "string" || text.length < min || text.length > max) {
    errors.push({ field, message: `Must be between ${min} and ${max} characters.` });
  }
  return text;
}

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/** Validate a new purchase request. `today` is an ISO date used for the needed-by check. */
export function validateNewRequest(input: unknown, today: string): Validation<ValidRequest> {
  if (!isRecord(input)) return { ok: false, errors: [{ field: "body", message: "Expected a JSON object." }] };
  const errors: FieldError[] = [];
  unknownFields(input, REQUEST_FIELDS, errors);

  const title = boundedText(input, "title", LIMITS.titleMin, LIMITS.titleMax, errors);
  const justification = boundedText(input, "justification", LIMITS.justificationMin, LIMITS.justificationMax, errors);

  const category = input.category;
  if (typeof category !== "string" || !(CATEGORIES as readonly string[]).includes(category)) {
    errors.push({ field: "category", message: `Must be one of ${CATEGORIES.join(", ")}.` });
  }

  const quantity = input.quantity;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > LIMITS.quantityMax) {
    errors.push({ field: "quantity", message: `Must be a whole number from 1 to ${LIMITS.quantityMax}.` });
  }

  const unitPriceCents = parseMoneyToCents(input.unitPrice);
  if (unitPriceCents === null || unitPriceCents <= 0) {
    errors.push({ field: "unitPrice", message: "Must be a positive amount with up to two decimals, e.g. \"249.99\"." });
  } else if (typeof quantity === "number" && Number.isInteger(quantity) && unitPriceCents * quantity > LIMITS.totalMaxCents) {
    errors.push({ field: "unitPrice", message: "The request total cannot exceed 1,000,000.00." });
  }

  const neededBy = input.neededBy;
  if (typeof neededBy !== "string" || !isValidIsoDate(neededBy)) {
    errors.push({ field: "neededBy", message: "Must be a date in YYYY-MM-DD format." });
  } else if (neededBy < today) {
    errors.push({ field: "neededBy", message: "Cannot be in the past." });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      category: category as Category,
      quantity: quantity as number,
      unitPriceCents: unitPriceCents as number,
      justification,
      neededBy: neededBy as string,
    },
  };
}

/** Validate an approve / reject / withdraw body. A rejection must explain itself. */
export function validateTransition(input: unknown, action: Action): Validation<ValidTransition> {
  if (!isRecord(input)) return { ok: false, errors: [{ field: "body", message: "Expected a JSON object." }] };
  const errors: FieldError[] = [];
  unknownFields(input, TRANSITION_FIELDS, errors);

  const version = input.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    errors.push({ field: "version", message: "Must be the request version you are acting on." });
  }

  const raw = input.comment;
  let comment: string | null = null;
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== "string" || raw.trim().length > LIMITS.commentMax) {
      errors.push({ field: "comment", message: `Must be text of at most ${LIMITS.commentMax} characters.` });
    } else {
      comment = raw.trim() === "" ? null : raw.trim();
    }
  }
  if (action === "REJECT" && (comment === null || comment.length < LIMITS.rejectReasonMin)) {
    errors.push({ field: "comment", message: `A rejection needs a reason of at least ${LIMITS.rejectReasonMin} characters.` });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { version: version as number, comment } };
}
