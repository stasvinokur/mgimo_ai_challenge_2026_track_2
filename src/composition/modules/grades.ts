import "server-only";
import { GetCourseActions } from "@/application/grades/get-course-actions";
import {
  GetCourseGrades,
  GetMyGrades,
} from "@/application/grades/get-my-grades";
import { GetScoreHistory } from "@/application/grades/history";
import type { Clock } from "@/application/ports/clock";
import { getDatabase } from "@/infrastructure/db/client";
import { PostgresGradesRepository } from "@/infrastructure/db/repositories/grades/grades";
import { PostgresScoreHistoryRepository } from "@/infrastructure/db/repositories/grades/history";

export function createGradesModule({ clock }: { clock: Clock }) {
  const repository = new PostgresGradesRepository(getDatabase);
  return {
    getScoreHistory: new GetScoreHistory(
      repository,
      new PostgresScoreHistoryRepository(getDatabase),
    ),
    getCourseActions: new GetCourseActions(repository, clock),
    getMyGrades: new GetMyGrades(repository, clock),
    getCourseGrades: new GetCourseGrades(repository, clock),
  };
}
