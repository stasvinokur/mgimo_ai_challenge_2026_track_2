import {
  isAutomaticStep,
  type OnboardingStepCode,
  onboardingStepCodes,
} from "@/domain/onboarding/steps";
import { ForbiddenError, NotFoundError } from "@/domain/shared/errors";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { OnboardingFeatures, OnboardingRepository } from "./ports";

export type { OnboardingStepCode } from "@/domain/onboarding/steps";

export interface OnboardingDto {
  steps: {
    code: OnboardingStepCode;
    completed: boolean;
    automatic: boolean;
  }[];
  completed: number;
  total: number;
}

export class GetMyOnboarding {
  constructor(
    private readonly repository: OnboardingRepository,
    private readonly clock: Clock,
    private readonly features: OnboardingFeatures = {
      push: false,
      passkey: false,
    },
  ) {}

  async execute(actor: Actor): Promise<OnboardingDto | null> {
    if (actor.kind !== "student") throw new ForbiddenError();
    const snapshot = await this.repository.findForUser(actor.userId);
    if (!snapshot) throw new NotFoundError();
    if (snapshot.course !== 1 || snapshot.completedCodes.includes("hidden"))
      return null;
    const completed = new Set(snapshot.completedCodes);
    const automatic = onboardingStepCodes
      .filter(isAutomaticStep)
      .filter((code) => snapshot.automatic[code] && !completed.has(code));
    if (automatic.length) {
      await this.repository.completeForUser(
        actor.userId,
        automatic,
        this.clock.now().toISOString(),
      );
      for (const code of automatic) completed.add(code);
    }
    const steps = onboardingStepCodes
      .filter((code) => {
        if (code === "push" || code === "passkey") return this.features[code];
        return true;
      })
      .map((code) => ({
        code,
        completed: completed.has(code),
        automatic: isAutomaticStep(code),
      }));
    return {
      steps,
      completed: steps.filter((step) => step.completed).length,
      total: steps.length,
    };
  }
}
