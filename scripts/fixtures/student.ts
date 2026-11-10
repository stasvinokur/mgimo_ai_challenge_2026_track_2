import type * as s from "../../src/infrastructure/db/schema/student";
import type { FixtureContext } from "./shared";

export const demoGroups = ["fmo", "imp"] as const;
const backgroundNames = [
  "Алина Ветрова",
  "Борис Ладин",
  "Вера Мирская",
  "Денис Луговой",
  "Елена Тихова",
  "Илья Росин",
  "Кира Светлова",
  "Лев Долин",
  "Мила Лесная",
  "Никита Берестов",
  "Ольга Речная",
  "Павел Яснов",
];

export function studentFixtures(ctx: FixtureContext) {
  const faculties: (typeof s.faculties.$inferInsert)[] = demoGroups.map(
    (key, i) => ({
      ...ctx.row(`faculty:${key}`),
      code: key.toUpperCase(),
      title:
        i === 0
          ? "Факультет международных отношений"
          : "Институт маркетинга и предпринимательства",
    }),
  );
  const programs: (typeof s.programs.$inferInsert)[] = demoGroups.map(
    (key, i) => ({
      ...ctx.row(`program:${key}`),
      facultyId: ctx.row(`faculty:${key}`).id,
      title:
        i === 0 ? "Международные отношения" : "Маркетинг и предпринимательство",
    }),
  );
  const groups: (typeof s.groups.$inferInsert)[] = demoGroups.map((key, i) => ({
    ...ctx.row(`group:${key}`),
    programId: ctx.row(`program:${key}`).id,
    title: i === 0 ? "ДЕМО-ФМО-2" : "ДЕМО-ИМП-1",
  }));
  const profiles = [
    { key: "anna", fullName: "Анна Соколова", group: "fmo", user: "anna" },
    { key: "timur", fullName: "Тимур Белов", group: "imp", user: "timur" },
    ...backgroundNames.map((fullName, i) => ({
      key: `extra-${i + 1}`,
      fullName,
      group: i < 6 ? "fmo" : "imp",
      user: null,
    })),
  ];
  const students: (typeof s.students.$inferInsert)[] = profiles.map(
    (profile, i) => ({
      ...ctx.row(`student:${profile.key}`),
      fullName: profile.fullName,
      userId: profile.user ? ctx.row(`user:${profile.user}`).id : null,
      facultyId: ctx.row(`faculty:${profile.group}`).id,
      programId: ctx.row(`program:${profile.group}`).id,
      groupId: ctx.row(`group:${profile.group}`).id,
      course: profile.group === "fmo" ? 2 : 1,
      recordBookNo: `DEMO-${String(i + 1).padStart(4, "0")}`,
      scholarship:
        profile.key === "anna"
          ? "increased"
          : profile.key === "timur"
            ? "none"
            : "academic",
      targetScore: profile.key === "anna" ? 86 : 70,
    }),
  );
  const staff: (typeof s.staff.$inferInsert)[] = [
    {
      ...ctx.row("staff:marina"),
      userId: ctx.row("user:marina").id,
      fullName: "Марина Петровна Ладова",
    },
  ];
  const staffFaculties: (typeof s.staffFaculties.$inferInsert)[] =
    demoGroups.map((key) => ({
      staffId: ctx.row("staff:marina").id,
      facultyId: ctx.row(`faculty:${key}`).id,
    }));
  return { faculties, programs, groups, students, staff, staffFaculties };
}
