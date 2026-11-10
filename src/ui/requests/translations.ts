import type { RequestField, RequestTypeDto } from "@/application/requests/dto";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";

type MessageKey = keyof typeof requestsMessages;

function knownMessage(language: Language, key: string, fallback: string) {
  return language === "en" && Object.hasOwn(requestsMessages, key)
    ? t(language, requestsMessages, key as MessageKey)
    : fallback;
}

export function requestTypeTitle(
  language: Language,
  type: Pick<RequestTypeDto, "code" | "title">,
) {
  return knownMessage(language, `title_${type.code}`, type.title);
}

export function requestTypeDescription(
  language: Language,
  type: Pick<RequestTypeDto, "code" | "description">,
) {
  return knownMessage(language, `description_${type.code}`, type.description);
}

export function requestFieldTitle(
  language: Language,
  field: Pick<RequestField, "name" | "title">,
) {
  return knownMessage(language, `field_${field.name}`, field.title);
}

export function requestErrorMessage(
  language: Language,
  error: { code?: string; message: string },
) {
  const key = `error_${error.code ?? "INTERNAL_ERROR"}`;
  return Object.hasOwn(requestsMessages, key)
    ? t(language, requestsMessages, key as MessageKey)
    : language === "ru"
      ? error.message
      : t(language, requestsMessages, "error_INTERNAL_ERROR");
}

export function requestFieldError(
  language: Language,
  code: string,
  field?: Pick<RequestField, "maxLength">,
) {
  return Object.hasOwn(requestsMessages, code)
    ? t(language, requestsMessages, code as MessageKey, {
        maxLength: field?.maxLength ?? 2000,
        days: code === "requestDateTooLate" ? 60 : 14,
      })
    : language === "ru"
      ? code
      : t(language, requestsMessages, "invalidField");
}
