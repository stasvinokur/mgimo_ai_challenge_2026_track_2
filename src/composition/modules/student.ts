import "server-only";
import { GetMyProfile } from "@/application/student/get-my-profile";
import { getDatabase } from "@/infrastructure/db/client";
import { PostgresStudentRepository } from "@/infrastructure/db/repositories/student/profile";

export function createStudentModule() {
  return {
    getMyProfile: new GetMyProfile(new PostgresStudentRepository(getDatabase)),
  };
}
