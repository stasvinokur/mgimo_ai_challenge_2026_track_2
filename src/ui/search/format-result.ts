import type { SearchResultDto } from "@/application/search/dto";
import { searchMessages } from "@/ui/i18n/dictionaries/search";
import { formatDate, formatNumber } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";

export function formatSearchTitle(
  language: Language,
  title: SearchResultDto["title"],
): string {
  if (typeof title === "string") return title;
  return `${title.publicNo ?? t(language, searchMessages, "draft")} · ${title.typeTitle ?? t(language, searchMessages, "request")}`;
}

export function formatSearchContext(
  language: Language,
  context: SearchResultDto["context"],
): string {
  const date = (iso: string) =>
    formatDate(language, iso, { day: "numeric", month: "long" });
  switch (context.code) {
    case "schedule":
      return `${date(context.startsAt)} · ${formatDate(language, context.startsAt, { hour: "2-digit", minute: "2-digit" })} · ${context.teacher} · ${t(language, searchMessages, "room", { room: context.room })}${context.status === "cancelled" ? t(language, searchMessages, "cancelledLesson") : context.status === "moved-from" ? t(language, searchMessages, "movedLesson") : ""}`;
    case "course":
      return t(language, searchMessages, "courseContext");
    case "work":
      return `${context.course} · ${context.score === null ? t(language, searchMessages, "ungraded") : t(language, searchMessages, "score", { score: formatNumber(language, context.score), max: formatNumber(language, context.maxScore) })} · ${t(language, searchMessages, "deadline", { date: date(context.dueAt) })}`;
    case "request":
      return t(language, searchMessages, "ownRequest", {
        status: t(language, searchMessages, context.status),
      });
    case "requestType":
      return t(language, searchMessages, "submitRequest", {
        description: context.description,
      });
    case "regulation":
      return `${context.documentTitle} · § ${context.section} · ${context.excerpt}`;
  }
}
