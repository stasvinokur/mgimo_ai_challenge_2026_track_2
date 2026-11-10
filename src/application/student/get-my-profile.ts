import type { Actor } from "../ports/actor";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import type { StudentRepository } from "./ports";

export class GetMyProfile {
  constructor(private readonly students: StudentRepository) {}

  async execute(actor: Actor) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const profile = await this.students.findProfileForStudent(actor.studentId);
    if (!profile) throw new NotFoundError();
    return profile;
  }
}
