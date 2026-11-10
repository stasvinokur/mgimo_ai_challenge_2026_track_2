import type { Language } from "@/ui/i18n/language";
import {
  type RussianDayCase,
  russianDay,
  russianNumber,
} from "@/ui/i18n/russian-numbers";

const latinLetters: Record<string, string> = {
  a: "эй",
  b: "би",
  c: "си",
  d: "ди",
  e: "и",
  f: "эф",
  g: "джи",
  h: "эйч",
  i: "ай",
  j: "джей",
  k: "кей",
  l: "эл",
  m: "эм",
  n: "эн",
  o: "оу",
  p: "пи",
  q: "кью",
  r: "ар",
  s: "эс",
  t: "ти",
  u: "ю",
  v: "ви",
  w: "дабл ю",
  x: "экс",
  y: "уай",
  z: "зет",
};

function spokenNumber(
  value: string,
  gender: Parameters<typeof russianNumber>[1] = "masculine",
  grammaticalCase: Parameters<typeof russianNumber>[2] = "nominative",
) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= 999_999
    ? russianNumber(number, gender, grammaticalCase)
    : [...value].map((digit) => russianNumber(Number(digit))).join(" ");
}

export function briefingSpokenText(
  text: string,
  language: Language = "ru",
  dateCase: RussianDayCase = "genitive",
) {
  let result = text
    .replace(/[«»“”„"'‘’]/g, "")
    .replace(/\bMSK\b/g, "")
    .replace(/МСК/g, "")
    .replace(/ДЕМО[-–—]?/gi, "")
    .replace(/·/g, ",");
  if (language === "en")
    return result
      .replace(/\s+([,.!?;:])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  result = result
    .replace(
      /Сейчас идёт (.+) до (\d{2}:\d{2})/,
      "Сейчас идёт $1, окончание в $2",
    )
    .replace(/, время\s*(?=[.!?])/g, "")
    .replace(
      /(\d{1,2}):(\d{2})/g,
      (_, hour: string, minute: string) =>
        `${russianNumber(Number(hour))} ${Number(minute) < 10 ? "ноль " : ""}${russianNumber(Number(minute))}`,
    )
    .replace(
      /\b(\d{1,2})(\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))/g,
      (_, day: string, month: string) =>
        `${Number(day) >= 1 && Number(day) <= 31 ? russianDay(Number(day), dateCase) : spokenNumber(day)}${month}`,
    )
    .replace(
      /(не меньше|из|до)\s+(\d+)/g,
      (_, prefix: string, value: string) =>
        `${prefix} ${spokenNumber(value, "masculine", "genitive")}`,
    )
    .replace(/\d+(?:[.,]\d+)?/g, (value, offset: number, source: string) => {
      const following = source.slice(offset + value.length);
      const gender = /^\s+минут/u.test(following)
        ? "accusative-feminine"
        : /^\s+изменени/u.test(following)
          ? "neuter"
          : "masculine";
      const [whole = "0", fraction] = value.split(/[.,]/);
      return `${spokenNumber(whole, gender)}${fraction ? ` запятая ${[...fraction].map((digit) => spokenNumber(digit)).join(" ")}` : ""}`;
    })
    .replace(
      /[a-z]/gi,
      (letter) => ` ${latinLetters[letter.toLowerCase()] ?? ""} `,
    )
    .replace(/№/g, " номер ")
    .replace(/%/g, " процентов ")
    .replace(/&/g, " и ")
    .replace(/[^А-Яа-яЁё\s.,!?;:\-–—]/g, " ");
  return result
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
