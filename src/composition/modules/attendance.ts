import "server-only";
import { headers } from "next/headers";
import type { Sql } from "postgres";
import { attendanceOrigin } from "@/application/attendance/origin";
import type { AttendanceRecords } from "@/application/attendance/ports";
import {
  GetAttendanceConfirmation,
  GetMyAttendance,
  MarkAttendance,
} from "@/application/attendance/student";
import {
  CloseTeacherAttendance,
  GetAttendanceLessons,
  GetTeacherAttendance,
  IssueAttendanceCode,
} from "@/application/attendance/teacher";
import { GetMyLessons } from "@/application/teacher/get-my-lessons";
import { PostgresAttendanceCourses } from "@/infrastructure/attendance/courses";
import { LocalAttendanceQrEncoder } from "@/infrastructure/attendance/qr";
import { CryptoAttendanceTokens } from "@/infrastructure/attendance/tokens";
import { PostgresAttendanceUnitOfWork } from "@/infrastructure/attendance/unit-of-work";
import { getBasePath } from "@/infrastructure/config/base-path";
import { getDatabase } from "@/infrastructure/db/client";
import { PostgresAttendanceRecords } from "@/infrastructure/db/repositories/attendance/repository";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { PostgresTeacherScheduleRepository } from "@/infrastructure/db/repositories/teacher/repository";
import { createSystemModule } from "./system";

export function createAttendanceRecords(
  system: ReturnType<typeof createSystemModule>,
  database: () => Sql = getDatabase,
): AttendanceRecords {
  return new PostgresAttendanceRecords(database, system.ids);
}

export function createAttendanceModule(
  system: ReturnType<typeof createSystemModule>,
) {
  const uow = new PostgresAttendanceUnitOfWork(getDatabase, system.ids, (sql) =>
    createAttendanceRecords(system, () => sql),
  );
  const tokens = new CryptoAttendanceTokens();
  const limiter = new PostgresRateLimiter(
    getDatabase,
    system.clock,
    system.ids,
  );
  return {
    getLessons: new GetAttendanceLessons(
      new GetMyLessons(
        new PostgresTeacherScheduleRepository(getDatabase),
        system.clock,
        createAttendanceRecords(system),
      ),
      system.clock,
    ),
    getTeacherAttendance: new GetTeacherAttendance(uow, system.clock),
    issueCode: new IssueAttendanceCode(
      uow,
      system.clock,
      tokens,
      new LocalAttendanceQrEncoder(),
      limiter,
      async () =>
        attendanceOrigin(
          await headers(),
          process.env.APP_ORIGIN ? system.getEnv("APP_ORIGIN") : undefined,
        ),
      getBasePath,
    ),
    closeAttendance: new CloseTeacherAttendance(
      uow,
      system.clock,
      limiter,
      tokens,
    ),
    getConfirmation: new GetAttendanceConfirmation(uow, tokens, system.clock),
    markAttendance: new MarkAttendance(uow, tokens, system.clock, limiter),
    getMyAttendance: new GetMyAttendance(
      createAttendanceRecords(system),
      new PostgresAttendanceCourses(getDatabase),
    ),
  };
}

export const attendanceUseCases = createAttendanceModule(createSystemModule());
