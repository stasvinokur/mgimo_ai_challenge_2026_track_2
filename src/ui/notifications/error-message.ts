import { notificationsMessages } from "@/ui/i18n/dictionaries/notifications";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";

export interface NotificationActionError {
  code: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
}

export function notificationErrorCode(error: NotificationActionError) {
  switch (error.code) {
    case "VALIDATION":
      return error.fieldErrors?.link?.includes("notificationLinkUnavailable")
        ? "notificationLinkUnavailable"
        : "notificationInvalid";
    case "FORBIDDEN":
      return "forbidden";
    case "NOT_FOUND":
      return "notFound";
    case "RATE_LIMITED":
      return "rateLimited";
    case "CONFLICT":
      return "conflict";
    default:
      return "actionFailed";
  }
}

export function notificationErrorMessage(
  language: Language,
  error: NotificationActionError,
) {
  return t(language, notificationsMessages, notificationErrorCode(error));
}
