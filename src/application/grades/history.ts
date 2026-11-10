import type { Actor } from "../ports/actor";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import type { GradesRepository } from "./ports";
import { parseCourseInput } from "./schemas";
import { reasonCodes, type ScoreReasonCode } from "./score-reasons";

export interface ScoreHistoryEntry {
  id: string;
  assessmentTitle: string;
  previousScore: number | null;
  newScore: number;
  reason: string | null;
  createdAt: string;
}

export interface ScoreHistoryRepository {
  listForStudentCourse(
    courseId: string,
    studentId: string,
  ): Promise<ScoreHistoryEntry[]>;
}

export class GetScoreHistory {
  constructor(
    private readonly grades: GradesRepository,
    private readonly history: ScoreHistoryRepository,
  ) {}

  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const { courseId } = parseCourseInput(input);
    const course = await this.grades.findByIdForStudent(
      courseId,
      actor.studentId,
    );
    if (!course) throw new NotFoundError();
    const entries = await this.history.listForStudentCourse(
      courseId,
      actor.studentId,
    );
    return {
      entries: entries.map((entry) => ({
        ...entry,
        reason:
          entry.reason === null
            ? null
            : reasonCodes.includes(entry.reason as ScoreReasonCode)
              ? (entry.reason as ScoreReasonCode)
              : ("clarification" as const),
      })),
    };
  }
}

export type ScoreHistoryDto = Awaited<ReturnType<GetScoreHistory["execute"]>>;
