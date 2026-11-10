import type { GradeCode } from "@/application/grades/messages";
import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import { formatDate, formatNumber } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";

export function gradeLabel(
  grade: { code: GradeCode },
  language: Language = "ru",
) {
  return t(language, gradesMessages, grade.code);
}

export function formatScore(value: number | null, language: Language = "ru") {
  return value === null
    ? t(language, gradesMessages, "noScore")
    : formatNumber(language, value, { maximumFractionDigits: 2 });
}

export function formatGradeDate(value: string, language: Language = "ru") {
  return formatDate(language, value, {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}
