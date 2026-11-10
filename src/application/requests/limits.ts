import { RateLimitedError } from "../shared/errors";

export const OPEN_DRAFT_LIMIT = 20;

export function submissionWindowStart(now: Date): string {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
}

export function enforceRequestLimit(
  count: number,
  kind: "drafts" | "submissions",
) {
  if (count < (kind === "drafts" ? OPEN_DRAFT_LIMIT : 20)) return;
  const error = new RateLimitedError();
  error.message =
    kind === "drafts"
      ? "Слишком много черновиков: удалите ненужные или отправьте готовые."
      : "Вы уже отправили 20 заявок за 24 часа. Попробуйте позже.";
  throw error;
}
