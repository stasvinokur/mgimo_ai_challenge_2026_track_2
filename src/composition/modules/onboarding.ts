import "server-only";
import { CompleteOnboardingStep } from "@/application/onboarding/complete-step";
import { GetMyOnboarding } from "@/application/onboarding/get-onboarding";
import { HideOnboarding } from "@/application/onboarding/hide-onboarding";
import type { OnboardingFeatures } from "@/application/onboarding/ports";
import { getDatabase } from "@/infrastructure/db/client";
import { PostgresOnboardingRepository } from "@/infrastructure/db/repositories/onboarding/repository";
import { createPasskeyVerifier } from "./passkey";
import { createPushSender } from "./push";
import { createSystemModule } from "./system";

// Read per request: steps appear only where the feature works on this server.
const defaultFeatures: OnboardingFeatures = {
  get push() {
    return createPushSender().enabled;
  },
  get passkey() {
    try {
      // WebAuthn rejects an IP-address origin; the verifier throws for it.
      createPasskeyVerifier();
      return true;
    } catch {
      return false;
    }
  },
};

export function createOnboardingModule(
  system = createSystemModule(),
  features: OnboardingFeatures = defaultFeatures,
) {
  const repository = new PostgresOnboardingRepository(getDatabase);
  const getMyOnboarding = new GetMyOnboarding(
    repository,
    system.clock,
    features,
  );
  return {
    getMyOnboarding,
    completeStep: new CompleteOnboardingStep(
      repository,
      system.clock,
      getMyOnboarding,
    ),
    hide: new HideOnboarding(repository, system.clock),
  };
}

export const onboarding = createOnboardingModule();
