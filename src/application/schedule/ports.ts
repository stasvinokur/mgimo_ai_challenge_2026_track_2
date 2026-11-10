import type { ScheduleData } from "@/domain/schedule/schedule";

export interface ScheduleRepository {
  findForStudent(studentId: string): Promise<ScheduleData | null>;
}

export interface CalendarTokenStore {
  replaceForStudent(
    studentId: string,
    id: string,
    tokenHash: string,
  ): Promise<void>;
  findStudentByHash(tokenHash: string): Promise<string | null>;
}

export interface CalendarTokens {
  generate(): string;
  hash(token: string): string;
}
