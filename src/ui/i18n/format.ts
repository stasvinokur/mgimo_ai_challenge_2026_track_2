import type { Language } from "./language";

const locales: Record<Language, string> = { ru: "ru-RU", en: "en-GB" };

export function formatDate(
  language: Language,
  value: string | Date,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(locales[language], {
    ...options,
    timeZone: "Europe/Moscow",
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function formatNumber(
  language: Language,
  value: number,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locales[language], options).format(value);
}
