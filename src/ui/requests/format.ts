import type { RequestField } from "@/application/requests/dto";
import { formatRequestFieldValue as russianFieldValue } from "@/application/requests/format";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import { formatDate, formatNumber } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";

export function formatRequestDate(
  value: string,
  withTime = false,
  language: Language = "ru",
) {
  return formatDate(language, value, {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}
export function workDays(value: number, language: Language = "ru") {
  const suffix = new Intl.PluralRules(language).select(value);
  const key =
    suffix === "one"
      ? "workDays_one"
      : suffix === "few"
        ? "workDays_few"
        : "workDays_other";
  return t(language, requestsMessages, key, {
    count: formatNumber(language, value),
  });
}
export const deliveryLabels = {
  pdf: requestsMessages.pdf.ru,
  pickup: requestsMessages.pickup.ru,
};
export function deliveryLabel(
  value: keyof typeof deliveryLabels,
  language: Language = "ru",
) {
  return t(language, requestsMessages, value);
}

export function formatRequestFieldValue(
  field: Pick<RequestField, "format">,
  value: string,
  language: Language = "ru",
) {
  const formatted = russianFieldValue(field, value);
  if (language === "ru" || formatted === value) return formatted;
  return formatDate(language, `${value}T00:00:00Z`, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
