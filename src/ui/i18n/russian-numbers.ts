type Gender = "masculine" | "feminine" | "neuter" | "accusative-feminine";
type NumberCase = "nominative" | "genitive";

const ones = [
  "ноль",
  "один",
  "два",
  "три",
  "четыре",
  "пять",
  "шесть",
  "семь",
  "восемь",
  "девять",
  "десять",
  "одиннадцать",
  "двенадцать",
  "тринадцать",
  "четырнадцать",
  "пятнадцать",
  "шестнадцать",
  "семнадцать",
  "восемнадцать",
  "девятнадцать",
];
const genitive = [
  "нуля",
  "одного",
  "двух",
  "трёх",
  "четырёх",
  "пяти",
  "шести",
  "семи",
  "восьми",
  "девяти",
  "десяти",
  "одиннадцати",
  "двенадцати",
  "тринадцати",
  "четырнадцати",
  "пятнадцати",
  "шестнадцати",
  "семнадцати",
  "восемнадцати",
  "девятнадцати",
];
const tens = [
  "",
  "",
  "двадцать",
  "тридцать",
  "сорок",
  "пятьдесят",
  "шестьдесят",
  "семьдесят",
  "восемьдесят",
  "девяносто",
];
const genitiveTens = [
  "",
  "",
  "двадцати",
  "тридцати",
  "сорока",
  "пятидесяти",
  "шестидесяти",
  "семидесяти",
  "восьмидесяти",
  "девяноста",
];
const hundreds = [
  "",
  "сто",
  "двести",
  "триста",
  "четыреста",
  "пятьсот",
  "шестьсот",
  "семьсот",
  "восемьсот",
  "девятьсот",
];
const genitiveHundreds = [
  "",
  "ста",
  "двухсот",
  "трёхсот",
  "четырёхсот",
  "пятисот",
  "шестисот",
  "семисот",
  "восьмисот",
  "девятисот",
];

export function russianNumber(
  value: number,
  gender: Gender = "masculine",
  grammaticalCase: NumberCase = "nominative",
): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > 999_999)
    throw new RangeError("Число вне диапазона речи.");
  const isGenitive = grammaticalCase === "genitive";
  if (value >= 1000) {
    const count = Math.floor(value / 1000);
    const form = new Intl.PluralRules("ru").select(count);
    const noun = isGenitive
      ? form === "one"
        ? "тысячи"
        : "тысяч"
      : form === "one"
        ? "тысяча"
        : form === "few"
          ? "тысячи"
          : "тысяч";
    return `${russianNumber(count, "feminine", grammaticalCase)} ${noun}${value % 1000 ? ` ${russianNumber(value % 1000, gender, grammaticalCase)}` : ""}`;
  }
  const parts: string[] = [];
  if (value >= 100)
    parts.push(
      (isGenitive ? genitiveHundreds : hundreds)[Math.floor(value / 100)] ?? "",
    );
  let rest = value % 100;
  if (rest >= 20) {
    parts.push((isGenitive ? genitiveTens : tens)[Math.floor(rest / 10)] ?? "");
    rest %= 10;
  }
  if (rest || !parts.length) {
    let word = (isGenitive ? genitive : ones)[rest] ?? "";
    if (rest === 1 && gender !== "masculine")
      word = isGenitive
        ? "одной"
        : gender === "neuter"
          ? "одно"
          : gender === "accusative-feminine"
            ? "одну"
            : "одна";
    if (rest === 2 && gender.includes("feminine") && !isGenitive) word = "две";
    parts.push(word);
  }
  return parts.join(" ");
}

const genitiveDays = [
  "",
  "первого",
  "второго",
  "третьего",
  "четвёртого",
  "пятого",
  "шестого",
  "седьмого",
  "восьмого",
  "девятого",
  "десятого",
  "одиннадцатого",
  "двенадцатого",
  "тринадцатого",
  "четырнадцатого",
  "пятнадцатого",
  "шестнадцатого",
  "семнадцатого",
  "восемнадцатого",
  "девятнадцатого",
  "двадцатого",
  "двадцать первого",
  "двадцать второго",
  "двадцать третьего",
  "двадцать четвёртого",
  "двадцать пятого",
  "двадцать шестого",
  "двадцать седьмого",
  "двадцать восьмого",
  "двадцать девятого",
  "тридцатого",
  "тридцать первого",
];
export type RussianDayCase = "genitive" | "nominative" | "accusative";
const neuterDays = [
  "",
  "первое",
  "второе",
  "третье",
  "четвёртое",
  "пятое",
  "шестое",
  "седьмое",
  "восьмое",
  "девятое",
  "десятое",
  "одиннадцатое",
  "двенадцатое",
  "тринадцатое",
  "четырнадцатое",
  "пятнадцатое",
  "шестнадцатое",
  "семнадцатое",
  "восемнадцатое",
  "девятнадцатое",
  "двадцатое",
  "двадцать первое",
  "двадцать второе",
  "двадцать третье",
  "двадцать четвёртое",
  "двадцать пятое",
  "двадцать шестое",
  "двадцать седьмое",
  "двадцать восьмое",
  "двадцать девятое",
  "тридцатое",
  "тридцать первое",
];
export function russianDay(
  value: number,
  grammaticalCase: RussianDayCase = "genitive",
) {
  const days = grammaticalCase === "genitive" ? genitiveDays : neuterDays;
  if (!days[value]) throw new RangeError("Некорректный день месяца.");
  return days[value] as string;
}
