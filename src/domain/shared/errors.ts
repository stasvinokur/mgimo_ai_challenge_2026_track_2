export type FieldErrors = Readonly<Record<string, readonly string[]>>;

export class NotFoundError extends Error {
  override readonly name = "NotFoundError";
  constructor() {
    super("Объект не найден.");
  }
}

export class ForbiddenError extends Error {
  override readonly name = "ForbiddenError";
  constructor() {
    super("Недостаточно прав для этого действия.");
  }
}

export class ValidationError extends Error {
  override readonly name = "ValidationError";
  constructor(readonly fieldErrors: FieldErrors) {
    super("Проверьте заполненные поля.");
  }
}

export class ConflictError extends Error {
  override readonly name = "ConflictError";
  constructor() {
    super("Данные изменились. Обновите страницу и попробуйте снова.");
  }
}

export class RateLimitedError extends Error {
  override readonly name = "RateLimitedError";
  constructor() {
    super("Слишком много запросов. Попробуйте позже.");
  }
}
