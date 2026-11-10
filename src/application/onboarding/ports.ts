import type {
  AutomaticStepCode,
  StoredStepCode,
} from "@/domain/onboarding/steps";

export interface OnboardingSnapshot {
  course: number;
  completedCodes: readonly string[];
  automatic: Readonly<Record<AutomaticStepCode, boolean>>;
}

export interface OnboardingRepository {
  findForUser(userId: string): Promise<OnboardingSnapshot | null>;
  completeForUser(
    userId: string,
    codes: readonly StoredStepCode[],
    completedAt: string,
  ): Promise<void>;
}

export interface OnboardingFeatures {
  push: boolean;
  passkey: boolean;
}
