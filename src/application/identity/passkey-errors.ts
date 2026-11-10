import {
  ConflictError,
  ForbiddenError,
  RateLimitedError,
} from "../shared/errors";

export const PASSKEY_REAUTHENTICATION_REQUIRED =
  "PASSKEY_REAUTHENTICATION_REQUIRED";
export const PASSKEY_LIMIT_REACHED = "PASSKEY_LIMIT_REACHED";

export class PasskeyReauthenticationRequiredError extends ForbiddenError {
  override readonly message = "Чтобы добавить ключ доступа, войдите заново";
}

export class PasskeyLimitError extends ConflictError {
  override readonly message =
    "Можно добавить не больше 10 ключей доступа. Удалите ненужный ключ и попробуйте снова.";
}

export class PasskeyRegistrationRateLimitedError extends RateLimitedError {
  override readonly message =
    "Можно добавить не больше 3 ключей доступа за 15 минут. Попробуйте позже.";
}
