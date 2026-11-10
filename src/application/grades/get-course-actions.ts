import { courseActions } from "@/domain/grades/course-actions";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../shared/errors";
import { calculateWhatIf } from "./calculation";
import type { GradesRepository } from "./ports";
import { parseCourseActionsInput } from "./schemas";

export class GetCourseActions {
  constructor(
    private readonly repository: GradesRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const { courseId, workId } = parseCourseActionsInput(input);
    const record = await this.repository.listForStudent(actor.studentId);
    const course = record?.courses.find((item) => item.id === courseId);
    if (
      !record ||
      !course ||
      (workId && !course.works.some((work) => work.id === workId))
    )
      throw new NotFoundError();
    try {
      const now = this.clock.now();
      const plan = courseActions(
        course,
        record.targetScore,
        now.toISOString(),
        workId,
      );
      if (!plan) return null;
      const baseline = calculateWhatIf(
        course.works,
        {},
        record.targetScore,
      ).total;
      const selectedWork = course.works.find((work) => work.id === plan.workId);
      return {
        courseId,
        courseTitle: course.title,
        workId: plan.workId,
        appeal: { question: plan.appeal.question },
        assistantContext: {
          workTitle: selectedWork?.title ?? null,
          dueAt: selectedWork?.dueAt ?? null,
          overdue: course.works.some(
            (work) =>
              work.id === plan.workId && Date.parse(work.dueAt) < now.getTime(),
          ),
          total: baseline,
          target: record.targetScore,
        },
        options: plan.options.map((option) => {
          const work = course.works.find((item) => item.id === option.workId);
          return {
            workId: option.workId,
            dueAt: option.dueAt,
            score: option.score,
            total: option.total,
            reachesTarget: option.reachesTarget,
            code: work
              ? Date.parse(work.dueAt) < now.getTime()
                ? ("overdue" as const)
                : ("submit" as const)
              : ("review" as const),
            workTitle: work?.title ?? null,
            maxScore: work?.maxScore ?? null,
            baseline,
            target: record.targetScore,
            notes: [
              ...(course.works.filter((item) => item.score === null).length >
                1 && work
                ? ["other-work-zero" as const]
                : []),
              ...(work?.isRequired ? ["required-confirmation" as const] : []),
            ],
            outcomes:
              option.workId !== null && option.score !== null
                ? (calculateWhatIf(
                    course.works,
                    { [option.workId]: option.score },
                    record.targetScore,
                  ).remaining.find((branch) => branch.id === option.workId)
                    ?.outcomes ?? null)
                : null,
          };
        }),
      };
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      return null;
    }
  }
}

export type CourseActionsDto = NonNullable<
  Awaited<ReturnType<GetCourseActions["execute"]>>
>;
