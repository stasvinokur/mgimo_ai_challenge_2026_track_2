import { expect, it } from "vitest";
import { russianDay, russianNumber } from "@/ui/i18n/russian-numbers";
import {
  buildTodayBriefing,
  buildTodayBriefingForms,
} from "@/ui/today/briefing";
import { briefingSpokenText } from "@/ui/today/briefing-text";
import { gradeFixtures } from "../../scripts/fixtures/grades";
import { notificationFixtures } from "../../scripts/fixtures/notifications";
import { requestFixtures } from "../../scripts/fixtures/requests";
import { scheduleFixtures } from "../../scripts/fixtures/schedule";
import { studentFixtures } from "../../scripts/fixtures/student";
import { todayFixture } from "../fakes/today";

const numbers = [
  0, 1, 2, 4, 5, 11, 12, 13, 14, 19, 20, 21, 22, 100, 101, 102, 111, 1000,
];
const words = [
  "ноль",
  "один",
  "два",
  "четыре",
  "пять",
  "одиннадцать",
  "двенадцать",
  "тринадцать",
  "четырнадцать",
  "девятнадцать",
  "двадцать",
  "двадцать один",
  "двадцать два",
  "сто",
  "сто один",
  "сто два",
  "сто одиннадцать",
  "одна тысяча",
];

it.each(numbers.map((value, i) => [value, words[i]] as const))(
  "число %s произносится %s",
  (value, word) => {
    expect(russianNumber(value)).toBe(word);
  },
);
it.each([
  [1, "одну минуту"],
  [2, "две минуты"],
  [4, "четыре минуты"],
  [5, "пять минут"],
  [11, "одиннадцать минут"],
  [21, "двадцать одну минуту"],
  [22, "двадцать две минуты"],
] as const)("через %s минут: род и падеж", (value, expected) => {
  const suffix = new Intl.PluralRules("ru").select(value);
  expect(
    briefingSpokenText(
      `Через ${value} ${suffix === "one" ? "минуту" : suffix === "few" ? "минуты" : "минут"}`,
    ),
  ).toBe(`Через ${expected}`);
});
it("время, даты, аудитории, падеж после «из» и служебные знаки", () => {
  expect(briefingSpokenText("В 09:05 МСК, аудитория ДЕМО-102 · «Тест»")).toBe(
    "В девять ноль пять, аудитория сто два, Тест",
  );
  expect(briefingSpokenText("1 ноября, 21 ноября, 31 декабря")).toBe(
    "первого ноября, двадцать первого ноября, тридцать первого декабря",
  );
  expect(briefingSpokenText("нужно не меньше 77 из 100")).toBe(
    "нужно не меньше семидесяти семи из ста",
  );
  expect(
    briefingSpokenText("Сейчас идёт «Курс» до 09:05 МСК, аудитория 101."),
  ).toBe("Сейчас идёт Курс, окончание в девять ноль пять, аудитория сто один.");
  expect(briefingSpokenText("ещё 1 изменение")).toBe("ещё одно изменение");
  expect(briefingSpokenText("Номер 1000000")).toBe(
    "Номер один ноль ноль ноль ноль ноль ноль",
  );
  expect(briefingSpokenText("“Course” 09:05 MSK", "en")).toBe("Course 09:05");
  expect(briefingSpokenText("'Course' 09:05 MSK", "en")).toBe("Course 09:05");
});

function assertSpoken(text: string) {
  const spoken = briefingSpokenText(text);
  expect(spoken).not.toMatch(/[\dA-Za-z«»“”"·]|МСК|ДЕМО/u);
  expect(spoken).toMatch(/^[А-Яа-яЁё .,!?;:\-–—]+$/u);
  expect(spoken.length).toBeLessThanOrEqual(600);
}

it("свойство для всех строк сида, которые могут попасть в сводку", () => {
  const d = todayFixture();
  const schedule = scheduleFixtures(d.ctx);
  const grades = gradeFixtures(d.ctx, studentFixtures(d.ctx).students);
  const requests = requestFixtures(d.ctx);
  const strings = [
    ...schedule.courses.map((item) => item.title),
    ...schedule.rooms.map((item) => item.title),
    ...schedule.teachers.map((item) => item.fullName),
    ...grades.assessments.map((item) => item.title),
    ...requests.requestTypes.map((item) => item.title),
    ...notificationFixtures(d.ctx).notifications.map((item) => item.title),
  ];
  expect(strings.length).toBeGreaterThan(30);
  for (const text of strings) assertSpoken(text);
});

it("свойство: обе формы совпадают числом и порядком на всех ветвях и числах", async () => {
  const d = todayFixture();
  for (const actor of [d.anna, d.timur]) {
    const original = await d.overview.execute(actor);
    for (const language of ["ru", "en"] as const) {
      for (const minutes of numbers) {
        for (const kind of [
          "moved",
          "room",
          "cancelled",
          "replaced",
        ] as const) {
          const data = structuredClone(original);
          if (data.schedule.ok) {
            for (const lesson of data.schedule.data.changes)
              for (const change of lesson.changes) change.kind = kind;
          }
          const now = new Date(
            Date.parse(data.asOf) + minutes * 60_000,
          ).toISOString();
          const pairs = buildTodayBriefingForms(data, now, language);
          expect(pairs.map((pair) => pair.visible)).toEqual(
            buildTodayBriefing(data, now, language),
          );
          for (const pair of pairs) {
            if (language === "ru") assertSpoken(pair.spoken);
            else {
              expect(pair.spoken).toBe(
                briefingSpokenText(pair.visible, language),
              );
              expect(pair.spoken).not.toMatch(/[«»“”"]|MSK/);
            }
          }
        }
      }
    }
  }
});

const dateCases = [
  [1, "первое", "первого"],
  [2, "второе", "второго"],
  [3, "третье", "третьего"],
  [11, "одиннадцатое", "одиннадцатого"],
  [20, "двадцатое", "двадцатого"],
  [21, "двадцать первое", "двадцать первого"],
  [23, "двадцать третье", "двадцать третьего"],
  [30, "тридцатое", "тридцатого"],
  [31, "тридцать первое", "тридцать первого"],
] as const;
it.each(dateCases)(
  "день %s: именительный, винительный и родительный",
  (day, neuter, genitive) => {
    expect(russianDay(day, "nominative")).toBe(neuter);
    expect(russianDay(day, "accusative")).toBe(neuter);
    expect(russianDay(day, "genitive")).toBe(genitive);
  },
);
it.each(dateCases)(
  "построитель выбирает падеж дня %s по шаблону",
  async (day, neuter, genitive) => {
    const d = todayFixture();
    const anna = await d.overview.execute(d.anna);
    const at = `2027-01-${String(day).padStart(2, "0")}T09:00:00.000Z`;
    if (!anna.schedule.ok) throw new Error("Нужно расписание");
    for (const lesson of anna.schedule.data.changes)
      for (const change of lesson.changes) {
        change.kind = "moved";
        change.after.startsAt = at;
      }
    const action = anna.actions[0];
    if (!action) throw new Error("Нужно действие");
    action.dueAt = at;
    const pairs = buildTodayBriefingForms(anna, anna.asOf);
    expect(
      pairs.find((pair) => pair.visible.startsWith("Изменение:"))?.spoken,
    ).toContain(`перенесено на ${neuter} января`);
    expect(
      pairs.find((pair) => pair.visible.startsWith("Главное:"))?.spoken,
    ).toContain(`срок — ${neuter} января`);
    const timur = await d.overview.execute(d.timur);
    if (!timur.study.ok) throw new Error("Нужна учёба");
    timur.study.data.session = { at, days: 100 };
    expect(
      buildTodayBriefingForms(timur, timur.asOf).find((pair) =>
        pair.visible.startsWith("Сессия"),
      )?.spoken,
    ).toContain(`Сессия начинается ${genitive} января`);
  },
);
