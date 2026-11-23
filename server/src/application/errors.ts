// Application errors carry an HTTP status and a stable error code for the client.

import type { ErrorCode, FieldError } from "../../../shared/contracts.ts";

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: FieldError[] | undefined;

  constructor(status: number, code: ErrorCode, message: string, details?: FieldError[]) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string) => new AppError(400, "BAD_REQUEST", message);
export const validationFailed = (details: FieldError[]) =>
  new AppError(422, "VALIDATION_FAILED", "The request contains invalid fields.", details);
export const unauthenticated = () => new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
export const invalidCredentials = () => new AppError(401, "INVALID_CREDENTIALS", "Invalid username or password.");
export const forbidden = (message: string) => new AppError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found.") => new AppError(404, "NOT_FOUND", message);
export const conflict = (message: string) => new AppError(409, "CONFLICT", message);
export const invalidTransition = (message: string) => new AppError(409, "INVALID_TRANSITION", message);
export const serviceBusy = () => new AppError(503, "SERVICE_BUSY", "The database is busy. Try again in a moment.");
