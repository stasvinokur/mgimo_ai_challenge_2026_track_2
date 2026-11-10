import type { Logger } from "@/application/ports/logger";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/application/shared/errors";

export function assistantToolError(error: unknown, logger: Logger) {
  let code: string;
  let message: string;
  if (error instanceof NotFoundError) {
    code = "NOT_FOUND";
    message = "Данные не найдены.";
  } else if (error instanceof ValidationError) {
    code = "VALIDATION";
    message = "Проверьте параметры действия.";
  } else if (error instanceof RateLimitedError) {
    code = "RATE_LIMITED";
    message = "Достигнут лимит действия. Попробуйте позже.";
  } else if (error instanceof ConflictError) {
    code = "CONFLICT";
    message = "Данные изменились. Откройте черновик заново.";
  } else if (error instanceof ForbiddenError) {
    code = "FORBIDDEN";
    message = "Нет доступа к этому действию.";
  } else {
    code = "INTERNAL";
    message = "Не удалось выполнить действие. Попробуйте позже.";
    logger.error("assistant_tool_failed", { code: "ASSISTANT_TOOL_INTERNAL" });
  }
  return { error: { code, message } };
}
