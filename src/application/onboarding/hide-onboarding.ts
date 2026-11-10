import { ForbiddenError, NotFoundError } from "@/domain/shared/errors";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { OnboardingRepository } from "./ports";

export class HideOnboarding {
  constructor(
    private readonly repository: OnboardingRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor): Promise<null> {
    if (actor.kind !== "student") throw new ForbiddenError();
    const snapshot = await this.repository.findForUser(actor.userId);
    if (snapshot?.course !== 1) throw new NotFoundError();
    await this.repository.completeForUser(
      actor.userId,
      ["hidden"],
      this.clock.now().toISOString(),
    );
    return null;
  }
}
