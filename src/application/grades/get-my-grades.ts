import {
  averageCurrentScore,
  currentScore,
  weightedTotal,
  workStatus,
} from "@/domain/grades/grading-policy";
import { trafficLight } from "@/domain/grades/traffic-light";
import { whatIf } from "@/domain/grades/what-if";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../shared/errors";
import { calculateWhatIf } from "./calculation";
import { legacyScholarship } from "./legacy-scholarship";
import type { CourseGrades, GradesRepository } from "./ports";
import { parseCourseInput } from "./schemas";
import { calculateScholarship } from "./scholarship";

function courseDto(course: CourseGrades, target: number, now: string) {
  const base = {
    ...course,
    works: course.works.map((work) => ({
      ...work,
      status: workStatus(work, now),
    })),
    openDebts: course.works.filter(
      (work) => work.isRequired && workStatus(work, now) === "overdue",
    ).length,
  };
  try {
    const forecast = calculateWhatIf(course.works, {}, target);
    const { tone } = trafficLight(course.works, target, now);
    const code =
      tone === "danger"
        ? base.openDebts > 0
          ? ("debt" as const)
          : ("plan" as const)
        : tone === "success"
          ? ("good" as const)
          : forecast.targetReachable
            ? ("borderline" as const)
            : ("target-unreachable" as const);
    const secured = weightedTotal(course.works);
    return {
      ...base,
      calculationStatus: "ready" as const,
      currentScore: currentScore(course.works),
      secured,
      forecast,
      grade: forecast.grade,
      light: {
        tone,
        code,
        hasPendingWorks: course.works.some((work) => work.score === null),
      },
    };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return {
      ...base,
      calculationStatus: "unavailable" as const,
      currentScore: null,
      secured: null,
      forecast: null,
      grade: null,
      light: {
        tone: "neutral" as const,
        code: "clarification" as const,
        hasPendingWorks: course.works.some((work) => work.score === null),
      },
    };
  }
}

export type CourseGradesDto = ReturnType<typeof courseDto>;
export type CalculatedCourseGradesDto = Extract<
  CourseGradesDto,
  { calculationStatus: "ready" }
>;

export class GetMyGrades {
  constructor(
    private readonly repository: GradesRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: unknown = {}) {
    const data = await this.executeMessages(actor, input);
    return {
      ...data,
      courses: data.courses.map((course) => {
        if (course.calculationStatus !== "ready")
          return {
            ...course,
            light: {
              ...course.light,
              tone: "neutral" as const,
              label: "Данные по дисциплине уточняются",
              reason: "Для расчёта пока недостаточно проверенных данных.",
              action:
                "Проверьте раздел позже или уточните данные у преподавателя.",
            },
          };
        const forecast = whatIf(course.works, {}, data.targetScore);
        return {
          ...course,
          forecast: {
            ...course.forecast,
            grade: { ...course.forecast.grade, ...forecast.grade },
          },
          grade: { ...course.grade, ...forecast.grade },
          light: {
            ...course.light,
            ...trafficLight(course.works, data.targetScore, data.asOf),
          },
        };
      }),
      scholarship: legacyScholarship(data.courses, data.scholarship),
    };
  }

  async executeMessages(actor: Actor, _input: unknown = {}) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const record = await this.repository.listForStudent(actor.studentId);
    if (!record) throw new NotFoundError();
    const now = this.clock.now().toISOString();
    const priority = { danger: 0, warning: 1, neutral: 2, success: 3 };
    const courses = record.courses
      .map((course) => courseDto(course, record.targetScore, now))
      .sort(
        (left, right) =>
          priority[left.light.tone] - priority[right.light.tone] ||
          left.title.localeCompare(right.title, "ru-RU"),
      );
    const graded = courses.flatMap((course) =>
      course.currentScore === null ? [] : [course.works],
    );
    const inGoodShape = courses.filter(
      (course) => course.light.tone === "success",
    ).length;
    return {
      targetScore: record.targetScore,
      asOf: now,
      courses,
      scholarship: calculateScholarship(courses, record.scholarship),
      summary: {
        averageScore: averageCurrentScore(graded),
        inGoodShape,
        needsAttention: courses.length - inGoodShape,
        openDebts: courses.reduce((sum, course) => sum + course.openDebts, 0),
        targetScore: record.targetScore,
      },
    };
  }
}

export type GradesDto = Awaited<ReturnType<GetMyGrades["execute"]>>;
export type GradesMessagesDto = Awaited<
  ReturnType<GetMyGrades["executeMessages"]>
>;

export class GetCourseGrades {
  constructor(
    private readonly repository: GradesRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const { courseId } = parseCourseInput(input);
    const record = await this.repository.findByIdForStudent(
      courseId,
      actor.studentId,
    );
    const course = record?.courses.find((item) => item.id === courseId);
    if (!record || !course) throw new NotFoundError();
    return {
      targetScore: record.targetScore,
      course: courseDto(
        course,
        record.targetScore,
        this.clock.now().toISOString(),
      ),
    };
  }
}
