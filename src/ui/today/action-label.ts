import type { TodayAction } from "@/application/today/get-today";
import { todayMessages } from "@/ui/i18n/dictionaries/today";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";
import { requestStatus } from "./format";

export function actionPresentation(
  action: Pick<TodayAction, "message">,
  language: Language = "ru",
) {
  const message = action.message;
  switch (message.code) {
    case "course":
      return {
        title: `${message.course} — ${t(language, todayMessages, ({ debt: "courseDebt", plan: "coursePlan", risk: "courseRisk" } as const)[message.state])}`,
        description: t(language, todayMessages, message.advice),
      };
    case "work":
      return {
        title: `${message.course}: ${message.work}`,
        description: t(
          language,
          todayMessages,
          message.overdue ? "workOverdue" : "workPending",
        ),
      };
    case "request":
      return {
        title: `${message.title} — ${requestStatus(message.status, language).toLocaleLowerCase(language === "ru" ? "ru-RU" : "en-GB")}`,
        description: t(
          language,
          todayMessages,
          message.status === "ready" ? "readyAdvice" : "clarifyAdvice",
        ),
      };
    case "notification":
      return { title: message.title, description: message.body };
  }
}

export function todayActionLabel(
  action: Pick<TodayAction, "section" | "href" | "label">,
  language: Language = "ru",
) {
  if (action.section !== "notifications" || action.href === "/notifications")
    return t(language, todayMessages, action.label);
  const path = action.href.split(/[?#]/, 1)[0] ?? "";
  const key =
    path === "/schedule" || path.startsWith("/schedule/")
      ? "viewChanges"
      : path === "/grades" || path.startsWith("/grades/")
        ? "checkWork"
        : /^\/requests\/[^/]+\/?$/.test(path)
          ? "openRequest"
          : "go";
  return t(language, todayMessages, key);
}
