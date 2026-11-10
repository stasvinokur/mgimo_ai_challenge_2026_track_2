export const reasonCodes = [
  "appeal_review",
  "entry_error",
  "retake",
  "excused",
  "late_submission",
] as const;

export type ScoreReasonCode = (typeof reasonCodes)[number];

export const reasonOptions: readonly {
  code: ScoreReasonCode;
  label: string;
}[] = [
  { code: "appeal_review", label: "Пересмотр после апелляции" },
  { code: "entry_error", label: "Исправление ошибки ввода" },
  { code: "retake", label: "Пересдача" },
  { code: "excused", label: "Уважительная причина" },
  { code: "late_submission", label: "Работа сдана позже" },
];

export function reasonLabel(code: string | null): string | null {
  if (code === null) return null;
  return (
    reasonOptions.find((option) => option.code === code)?.label ??
    "Причина уточняется"
  );
}
