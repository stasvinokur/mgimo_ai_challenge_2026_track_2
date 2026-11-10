import { formatDate } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";

export function pickupTime(value: string, language: Language = "ru") {
  return formatDate(language, value, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function pickupDate(value: string, language: Language = "ru") {
  return formatDate(language, value, {
    day: "numeric",
    month: "long",
    weekday: "short",
  });
}

export function pickupDay(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function pickupWindow(value: string) {
  return value.charAt(0).toLocaleLowerCase("ru-RU") + value.slice(1);
}
