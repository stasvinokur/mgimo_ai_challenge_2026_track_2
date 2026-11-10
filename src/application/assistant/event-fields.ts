import { eventDateErrors } from "@/domain/requests/event-release";

const months = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

export function asksAboutEvent(words: string) {
  return /хакатон|олимпиад|конференц|освобождени.*мероприяти/iu.test(words);
}

export function hasEventReleaseIntent(words: string) {
  if (
    /не\s+(?:(?:хочу|нужно|надо|буду)\s+)?(?:оформ|созда|пода|освобождени|пропущу)|без\s+(?:заявки|черновика)/iu.test(
      words,
    )
  )
    return false;
  return /освобождени|(?:пропущу|пропускаю|пропустил[аи]?|пропуск\p{L}*)\s+(?:пары?|пар|занятия|занятий)|(?:оформ\p{L}*|подать|пода\p{L}*|созда\p{L}*)\s+(?:мне\s+)?заявк/iu.test(
    words,
  );
}

function russianPeriods(words: string) {
  const pattern = new RegExp(
    `(?<![\\d–—-])(\\d{1,2})(?:\\s*[–—-]\\s*(\\d{1,2}))?\\s+(${months.join("|")})(?!\\p{L})`,
    "giu",
  );
  return [...words.matchAll(pattern)];
}

function explicitYears(words: string) {
  return [...new Set(words.match(/\b\d{4}\b/g) ?? [])];
}

function isYearReply(words: string) {
  return /^\s*(?:в\s+)?20\d{2}(?:\s+год[ауе]?)?[.!]?\s*$/iu.test(words);
}

// Dates come from the student's words, never from a model's inferred year.
export function explicitEventDates(
  words: string,
): { dateFrom: string; dateTo: string } | null {
  const matches = russianPeriods(words);
  const iso = [...words.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)];
  if (iso.length) {
    if (iso.length > 2 || matches.length) return null;
    const first = iso[0];
    const second = iso[1];
    if (!first) return null;
    if (second) {
      const between = words
        .slice(first.index + first[0].length, second.index)
        .trim();
      if (!/^(?:[–—-]|по|до)$/iu.test(between)) return null;
    }
    const dateFrom = first[0];
    const dateTo = second?.[0] ?? dateFrom;
    return !eventDateErrors(dateFrom, dateTo) ? { dateFrom, dateTo } : null;
  }
  const years = [...new Set(words.match(/\b20\d{2}\b/g) ?? [])];
  if (years.length !== 1) return null;
  if (matches.length !== 1) return null;
  const match = matches[0];
  if (!match) return null;
  const month = String(
    months.indexOf((match[3] ?? "").toLowerCase()) + 1,
  ).padStart(2, "0");
  const dateFrom = `${years[0]}-${month}-${match[1]?.padStart(2, "0")}`;
  const dateTo = `${years[0]}-${month}-${(match[2] ?? match[1])?.padStart(2, "0")}`;
  return eventDateErrors(dateFrom, dateTo) ? null : { dateFrom, dateTo };
}

export function resolveEventDates(
  question: string,
  history: readonly string[],
): { dateFrom: string; dateTo: string } | null {
  const explicit = explicitEventDates(question);
  if (explicit) return explicit;

  const periods = russianPeriods(question);
  const years = explicitYears(question);
  if (/\b\d{4}-\d{2}-\d{2}\b/u.test(question)) return null;
  const eventHistory = history.filter((previous, index) =>
    isEventQuestion(previous, history.slice(0, index).join("\n")),
  );

  if (periods.length === 1 && years.length === 0) {
    for (const previous of eventHistory.reverse()) {
      const previousPeriods = russianPeriods(previous);
      const hasIso = /\b\d{4}-\d{2}-\d{2}\b/u.test(previous);
      if (previousPeriods.length > 1) return null;
      const previousYears = explicitYears(previous);
      if (!previousYears.length) continue;
      if (previousYears.length !== 1) return null;
      if ((previousPeriods.length || hasIso) && !explicitEventDates(previous))
        return null;
      return explicitEventDates(`${question} ${previousYears[0]}`);
    }
  }

  // A year-only clarification fills the nearest period, not the whole history.
  if (isYearReply(question)) {
    for (const previous of eventHistory.reverse()) {
      const previousPeriods = russianPeriods(previous);
      const hasIso = /\b\d{4}-\d{2}-\d{2}\b/u.test(previous);
      if (!previousPeriods.length && !hasIso) continue;
      if (previousPeriods.length !== 1 || hasIso) return null;
      return explicitEventDates(
        `${previous.replace(/\b\d{4}\b/gu, "")} ${years[0]}`,
      );
    }
  }
  return null;
}

export function isEventQuestion(question: string, history: string) {
  return (
    asksAboutEvent(question) ||
    (asksAboutEvent(history) &&
      (/^\s*(?:в\s+)?(?:20\d{2}|\d{1,2}\s*[–—-]|\d{4}-\d{2}-\d{2})/u.test(
        question,
      ) ||
        russianPeriods(question).some((period) =>
          /^\s*(?:в\s+)?$/iu.test(question.slice(0, period.index)),
        ) ||
        (/^\s*(?:исправ\p{L}*|измен\p{L}*|уточн\p{L}*|перенес\p{L}*)\s+дат/iu.test(
          question,
        ) &&
          (russianPeriods(question).length > 0 ||
            /\b\d{4}-\d{2}-\d{2}\b/u.test(question)))))
  );
}
