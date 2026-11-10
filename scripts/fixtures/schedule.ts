import type * as s from "../../src/infrastructure/db/schema/schedule";
import { type FixtureContext, moscowDate } from "./shared";
import { demoGroups } from "./student";

export const courseTitles = {
  fmo: [
    "Иностранный язык",
    "История международных отношений",
    "Мировая экономика",
    "Политическая география",
    "Академическое письмо",
    "Международное право",
  ],
  imp: [
    "Основы маркетинга",
    "Математика для бизнеса",
    "Иностранный язык",
    "Экономика предприятия",
    "Деловые коммуникации",
    "Цифровые инструменты",
  ],
};
const teacherNames = [
  "Светлана Рощина",
  "Артём Ладов",
  "Нина Береговая",
  "Олег Яснев",
  "Тамара Луговая",
  "Юрий Светлин",
];

export function scheduleFixtures(ctx: FixtureContext) {
  const teachers: (typeof s.teachers.$inferInsert)[] = teacherNames.map(
    (fullName, i) => ({
      ...ctx.row(`teacher:${i}`),
      fullName,
      userId: i === 3 ? ctx.row("user:oleg").id : null,
    }),
  );
  const rooms: (typeof s.rooms.$inferInsert)[] = Array.from(
    { length: 4 },
    (_, i) => ({
      ...ctx.row(`room:${i}`),
      title: `ДЕМО-${101 + i}`,
      building: "Учебный корпус «Пульс» (вымышленный)",
    }),
  );
  const courses: (typeof s.courses.$inferInsert)[] = demoGroups.flatMap(
    (group) =>
      courseTitles[group].map((title, i) => ({
        ...ctx.row(`course:${group}:${i}`),
        title,
      })),
  );
  const scheduleSlots: (typeof s.scheduleSlots.$inferInsert)[] =
    demoGroups.flatMap((group, g) =>
      Array.from({ length: 6 }, (_, d) => d + 1).flatMap((weekday) =>
        [0, 1].map((pair): typeof s.scheduleSlots.$inferInsert => ({
          ...ctx.row(`slot:${group}:${weekday}:${pair}`),
          groupId: ctx.row(`group:${group}`).id,
          courseId: ctx.row(`course:${group}:${(weekday - 1 + pair) % 6}`).id,
          teacherId: ctx.row(`teacher:${(weekday - 1 + pair + g * 3) % 6}`).id,
          roomId: ctx.row(`room:${g * 2 + pair}`).id,
          weekday,
          startsAt: pair === 0 ? "09:00:00" : "10:45:00",
          endsAt: pair === 0 ? "10:30:00" : "12:15:00",
          kind: pair === 0 ? "lecture" : "seminar",
          weekParity: "any",
        })),
      ),
    );
  const weekday = ctx.studyDay.getUTCDay();
  const scheduleChanges: (typeof s.scheduleChanges.$inferInsert)[] = [
    {
      ...ctx.row("change:anna"),
      slotId: ctx.row(`slot:fmo:${weekday}:0`).id,
      date: moscowDate(ctx.studyDay),
      kind: "moved",
      oldStartsAt: "09:00:00",
      oldEndsAt: "10:30:00",
      oldRoomId: ctx.row("room:0").id,
      newDate: moscowDate(ctx.studyDay),
      newStartsAt: "13:00:00",
      newEndsAt: "14:30:00",
      newRoomId: ctx.row("room:1").id,
      reason: "Учебная встреча перенесена на 13:00 в аудиторию ДЕМО-102.",
      createdAt: ctx.at(0, 7),
    },
  ];
  return { teachers, rooms, courses, scheduleSlots, scheduleChanges };
}
