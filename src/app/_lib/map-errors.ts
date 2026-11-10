import "server-only";
import { forbidden, notFound } from "next/navigation";
import type { Logger } from "@/application/ports/logger";
import {
  ConflictError,
  type FieldErrors,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/application/shared/errors";
import { system } from "@/composition/container";

export interface ActionErrorResult {
  ok: false;
  status: number;
  error: {
    code: string;
    message: string;
    fieldErrors?: FieldErrors;
  };
}

export function mapActionError(
  error: unknown,
  logger: Logger = system.logger,
): ActionErrorResult {
  if (error instanceof NotFoundError) {
    return failure(404, "NOT_FOUND", error.message);
  }
  if (error instanceof ForbiddenError) {
    return failure(403, "FORBIDDEN", error.message);
  }
  if (error instanceof ValidationError) {
    return {
      ...failure(400, "VALIDATION", error.message),
      error: {
        code: "VALIDATION",
        message: error.message,
        fieldErrors: error.fieldErrors,
      },
    };
  }
  if (error instanceof ConflictError) {
    return failure(409, "CONFLICT", error.message);
  }
  if (error instanceof RateLimitedError) {
    return failure(429, "RATE_LIMITED", error.message);
  }
  logger.error("unexpected_error", { code: "INTERNAL_ERROR" });
  return failure(
    500,
    "INTERNAL_ERROR",
    "Не удалось выполнить действие. Попробуйте снова.",
  );
}

export function mapRouteError(
  error: unknown,
  logger: Logger = system.logger,
): Response {
  const result = mapActionError(error, logger);
  return Response.json(
    { error: result.error },
    {
      status: result.status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function mapPageError(
  error: unknown,
  logger: Logger = system.logger,
): never {
  if (error instanceof NotFoundError) notFound();
  if (error instanceof ForbiddenError) forbidden();
  const result = mapActionError(error, logger);
  throw new Error(result.error.message);
}

function failure(
  status: number,
  code: string,
  message: string,
): ActionErrorResult {
  return { ok: false, status, error: { code, message } };
}
