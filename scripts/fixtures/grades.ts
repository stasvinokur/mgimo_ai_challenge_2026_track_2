import type * as s from "../../src/infrastructure/db/schema/grades";
import type { students as studentTable } from "../../src/infrastructure/db/schema/student";
import type { FixtureContext } from "./shared";
import { demoGroups } from "./student";

export function gradeFixtures(
  ctx: FixtureContext,
  students: (typeof studentTable.$inferInsert)[],
) {
  const assessments: (typeof s.assessments.$inferInsert)[] = [];
  const scores: (typeof s.scores.$inferInsert)[] = [];
  const sessionsExams: (typeof s.sessionsExams.$inferInsert)[] = [];
  for (const group of demoGroups) {
    for (let course = 0; course < 6; course++) {
      sessionsExams.push({
        ...ctx.row(`exam:${group}:${course}`),
        courseId: ctx.row(`course:${group}:${course}`).id,
        groupId: ctx.row(`group:${group}`).id,
        kind: course % 2 === 0 ? "exam" : "credit",
        at: ctx.at(14 + course, 10),
        roomId: ctx.row(`room:${group === "fmo" ? 0 : 2}`).id,
      });
      for (let point = 0; point < 3; point++) {
        const key = `assessment:${group}:${course}:${point}`;
        const border = group === "fmo" && course === 0;
        const debt = group === "imp" && course === 0 && point === 0;
        const close = group === "imp" && course === 1 && point === 2;
        const remaining = border && point === 2;
        const assessment: typeof s.assessments.$inferInsert = {
          ...ctx.row(key),
          courseId: ctx.row(`course:${group}:${course}`).id,
          groupId: ctx.row(`group:${group}`).id,
          kind: point === 0 ? "control" : point === 1 ? "essay" : "test",
          title:
            point === 0
              ? "Обязательная контрольная работа"
              : point === 1
                ? "Учебное эссе"
                : "Итоговый тест",
          weight: border
            ? point === 2
              ? 10
              : 45
            : group === "imp" && course === 0
              ? point === 0
                ? 60
                : 20
              : point === 2
                ? 40
                : 30,
          maxScore: 100,
          isRequired: true,
          dueAt: ctx.at(debt ? -3 : close ? 2 : remaining ? 3 : -10 + point),
        };
        assessments.push(assessment);
        for (const student of students.filter(
          (row) => row.groupId === assessment.groupId,
        )) {
          const isAnna = student.seedKey === "demo:student:anna";
          const isTimur = student.seedKey === "demo:student:timur";
          const pending = (isAnna && remaining) || (isTimur && (debt || close));
          scores.push({
            ...ctx.row(`score:${student.seedKey}:${key}`),
            studentId: student.id,
            assessmentId: assessment.id,
            score: pending
              ? null
              : isAnna && border
                ? point === 0
                  ? 88
                  : 86
                : isTimur
                  ? 72
                  : 90,
            gradedAt: pending ? null : ctx.at(-11 + point),
          });
        }
      }
    }
  }
  const scoreEvents: (typeof s.scoreEvents.$inferInsert)[] = [
    {
      ...ctx.row("score-event:anna:appeal"),
      assessmentId: ctx.row("assessment:fmo:3:0").id,
      studentId: ctx.row("student:anna").id,
      studentUserId: ctx.row("user:anna").id,
      previousScore: 85,
      newScore: 90,
      changedByUserId: ctx.row("user:oleg").id,
      reason: "appeal_review",
      createdAt: ctx.at(-11),
    },
  ];
  return { assessments, scores, sessionsExams, scoreEvents };
}
