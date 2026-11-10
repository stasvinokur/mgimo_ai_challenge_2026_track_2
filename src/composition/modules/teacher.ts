import "server-only";
import { GetMyLessons } from "@/application/teacher/get-my-lessons";
import {
  GetTeacherGradebook,
  ListTeacherGradebooks,
  SetTeacherGrade,
} from "@/application/teacher/gradebook";
import { getDatabase } from "@/infrastructure/db/client";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { PostgresTeacherGradebookUnitOfWork } from "@/infrastructure/db/repositories/teacher/gradebook";
import { PostgresTeacherScheduleRepository } from "@/infrastructure/db/repositories/teacher/repository";
import { createAttendanceRecords } from "./attendance";
import type { createSystemModule } from "./system";

export function createTeacherModule(
  system: ReturnType<typeof createSystemModule>,
) {
  const gradebook = new PostgresTeacherGradebookUnitOfWork(
    getDatabase,
    system.ids,
  );
  return {
    listGradebooks: new ListTeacherGradebooks(gradebook, system.clock),
    getGradebook: new GetTeacherGradebook(gradebook, system.clock),
    setGrade: new SetTeacherGrade(
      gradebook,
      system.clock,
      system.ids,
      new PostgresRateLimiter(getDatabase, system.clock, system.ids),
    ),
    getMyLessons: new GetMyLessons(
      new PostgresTeacherScheduleRepository(getDatabase),
      system.clock,
      createAttendanceRecords(system),
    ),
  };
}
