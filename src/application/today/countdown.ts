import { addDays, moscowDate } from "@/domain/schedule/dates";

export type CountdownMessage =
  | { code: "now" }
  | { code: "minutes"; minutes: number }
  | { code: "hours"; hours: number; minutes: number }
  | { code: "tomorrow"; startsAt: string }
  | { code: "date"; startsAt: string };

export function getCountdown(startsAt: string, now: string): CountdownMessage {
  const remaining = Date.parse(startsAt) - Date.parse(now);
  if (remaining < 60_000) return { code: "now" };
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return { code: "minutes", minutes };
  const today = moscowDate(new Date(now));
  const date = moscowDate(new Date(startsAt));
  if (date === today)
    return {
      code: "hours",
      hours: Math.floor(minutes / 60),
      minutes: minutes % 60,
    };
  return { code: date === addDays(today, 1) ? "tomorrow" : "date", startsAt };
}

// Compatibility for the Russian assistant context, outside the today UI.
export function formatCountdown(startsAt: string, now: string): string {
  const message = getCountdown(startsAt, now);
  switch (message.code) {
    case "now":
      return "Начинается сейчас";
    case "minutes":
      return `Через ${message.minutes} мин`;
    case "hours":
      return `Через ${message.hours} ч${message.minutes ? ` ${message.minutes} мин` : ""}`;
    case "tomorrow":
    case "date": {
      const start = new Date(message.startsAt);
      const time = new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow",
        hour: "2-digit",
        minute: "2-digit",
      }).format(start);
      if (message.code === "tomorrow") return `Завтра в ${time}`;
      const day = new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow",
        day: "numeric",
        month: "long",
      }).format(start);
      return `${day} в ${time}`;
    }
  }
}
