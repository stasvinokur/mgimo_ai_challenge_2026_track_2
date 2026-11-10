import { ForbiddenError, NotFoundError } from "@/domain/shared/errors";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { GetMyOnboarding } from "./get-onboarding";
import type { OnboardingRepository } from "./ports";
import { parseCompleteStep } from "./schemas";

export class CompleteOnboardingStep {
  constructor(
    private readonly repository: OnboardingRepository,
    private readonly clock: Clock,
    private readonly getOnboarding: GetMyOnboarding,
  ) {}

  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const { stepCode } = parseCompleteStep(input);
    const snapshot = await this.repository.findForUser(actor.userId);
    if (snapshot?.course !== 1 || snapshot.completedCodes.includes("hidden"))
      throw new NotFoundError();
    await this.repository.completeForUser(
      actor.userId,
      [stepCode],
      this.clock.now().toISOString(),
    );
    return this.getOnboarding.execute(actor);
  }
}
