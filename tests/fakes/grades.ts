import { gradeFixtures } from "../../scripts/fixtures/grades";
import { scheduleFixtures } from "../../scripts/fixtures/schedule";
import { fixtureContext } from "../../scripts/fixtures/shared";
import { studentFixtures } from "../../scripts/fixtures/student";
import type {
  GradesRecord,
  GradesRepository,
} from "../../src/application/grades/ports";
import type { Actor } from "../../src/application/ports/actor";
import { FakeClock } from "./clock";
import { SequentialIdGenerator } from "./id-generator";

export function gradesFixture() {
  const clock = new FakeClock("2026-11-04T09:00:00Z");
  const ctx = fixtureContext(clock, new SequentialIdGenerator());
  const students = studentFixtures(ctx).students;
  const grades = gradeFixtures(ctx, students);
  const schedule = scheduleFixtures(ctx);
  const records = new Map<string, GradesRecord>();
  const actors: Record<string, Actor> = {};
  for (const name of ["anna", "timur"] as const) {
    const student = students.find(
      (item) => item.seedKey === `demo:student:${name}`,
    );
    if (!student) throw new Error("Нет вымышленного профиля.");
    actors[name] = {
      kind: "student",
      userId: ctx.row(`user:${name}`).id,
      studentId: student.id,
      facultyId: student.facultyId,
    };
    records.set(student.id, {
      targetScore: student.targetScore ?? 70,
      scholarship: student.scholarship ?? "none",
      courses: schedule.courses
        .filter((course) =>
          grades.assessments.some(
            (work) =>
              work.courseId === course.id && work.groupId === student.groupId,
          ),
        )
        .map((course) => ({
          id: course.id,
          title: course.title,
          works: grades.assessments
            .filter(
              (work) =>
                work.courseId === course.id && work.groupId === student.groupId,
            )
            .map((work) => ({
              id: work.id,
              title: work.title,
              weight: work.weight,
              maxScore: work.maxScore,
              dueAt: work.dueAt.toISOString(),
              isRequired: work.isRequired ?? false,
              score:
                grades.scores.find(
                  (score) =>
                    score.assessmentId === work.id &&
                    score.studentId === student.id,
                )?.score ?? null,
            })),
          exams: grades.sessionsExams
            .filter(
              (exam) =>
                exam.courseId === course.id && exam.groupId === student.groupId,
            )
            .map((exam) => ({
              id: exam.id,
              kind: exam.kind,
              at: exam.at.toISOString(),
              room:
                schedule.rooms.find((room) => room.id === exam.roomId)?.title ??
                "",
            })),
        })),
    });
  }
  const anna = actors.anna;
  const timur = actors.timur;
  if (!anna || !timur) throw new Error("Нет вымышленных участников.");
  return {
    clock,
    ctx,
    anna,
    timur,
    records,
    repository: new FakeGradesRepository(records),
  };
}

export class FakeGradesRepository implements GradesRepository {
  readonly calls: { studentId: string; courseId?: string }[] = [];
  constructor(readonly records: Map<string, GradesRecord>) {}

  async listForStudent(studentId: string) {
    this.calls.push({ studentId });
    return structuredClone(this.records.get(studentId) ?? null);
  }

  async findByIdForStudent(courseId: string, studentId: string) {
    this.calls.push({ studentId, courseId });
    const record = this.records.get(studentId);
    const course = record?.courses.find((item) => item.id === courseId);
    return record && course
      ? structuredClone({ ...record, courses: [course] })
      : null;
  }
}
