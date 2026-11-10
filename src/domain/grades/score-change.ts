import { addDays } from "../schedule/dates";
import { ValidationError } from "../shared/errors";
import { reasonCodes, type ScoreReasonCode } from "./score-reasons";

export function scoreChange(input: {
  score: number;
  maxScore: number;
  previousScore: number | null;
  reason?: string;
}) {
  if (
    !Number.isSafeInteger(input.score) ||
    !Number.isSafeInteger(input.maxScore) ||
    input.maxScore <= 0 ||
    input.score < 0 ||
    input.score > input.maxScore
  )
    throw new ValidationError({
      score: [`Введите целый балл от 0 до ${input.maxScore}.`],
    });
  if (
    input.reason !== undefined &&
    !reasonCodes.includes(input.reason as ScoreReasonCode)
  )
    throw new ValidationError({
      reason: ["Выберите причину из списка."],
    });
  const reason = input.reason as ScoreReasonCode | undefined;
  const changed = input.previousScore !== input.score;
  if (changed && input.previousScore !== null && !reason)
    throw new ValidationError({
      reason: ["Укажите причину изменения выставленного балла."],
    });
  return { changed, reason: reason || null };
}

export function canGradeReplacement(lessonDate: string, today: string) {
  return today >= lessonDate && today <= addDays(lessonDate, 6);
}
