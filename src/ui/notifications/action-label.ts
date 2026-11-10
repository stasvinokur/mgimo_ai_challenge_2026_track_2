import { notificationsMessages } from "@/ui/i18n/dictionaries/notifications";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";

export function notificationActionCode(link: string) {
  const path = link.split(/[?#]/, 1)[0];
  if (path === "/schedule") return "openSchedule";
  if (path === "/grades" || path?.startsWith("/grades/")) return "openGrades";
  if (/^\/requests\/[^/]+\/?$/.test(path ?? "")) return "openRequest";
  return "open";
}

export function notificationActionLabel(
  link: string,
  language: Language = "ru",
): string {
  return t(language, notificationsMessages, notificationActionCode(link));
}
