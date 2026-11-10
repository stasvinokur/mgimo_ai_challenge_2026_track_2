import type { Actor } from "../ports/actor";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import type { IdentityRepository } from "./ports";

export class GetStaffProfile {
  constructor(private readonly users: IdentityRepository) {}

  async execute(actor: Actor) {
    if (actor.kind !== "staff") throw new ForbiddenError();
    const profile = await this.users.findProfileForStaff(
      actor.staffId,
      actor.userId,
    );
    if (!profile) throw new NotFoundError();
    return profile;
  }
}
