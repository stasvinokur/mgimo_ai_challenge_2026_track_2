export const onboardingStepCodes = [
  "schedule",
  "calendar",
  "install",
  "regulations",
  "assistant",
  "push",
  "passkey",
] as const;

export type OnboardingStepCode = (typeof onboardingStepCodes)[number];

export const manualStepCodes = ["schedule", "install", "regulations"] as const;

export type ManualStepCode = (typeof manualStepCodes)[number];
export type AutomaticStepCode = Exclude<OnboardingStepCode, ManualStepCode>;
export type StoredStepCode = OnboardingStepCode | "hidden";

export function isAutomaticStep(
  code: OnboardingStepCode,
): code is AutomaticStepCode {
  return !manualStepCodes.some((manual) => manual === code);
}
