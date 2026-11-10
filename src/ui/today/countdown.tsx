"use client";

import { useLanguage } from "@/ui/i18n/language-provider";
import { localizedCountdown } from "./format";
import { useTodayNow } from "./use-now";

export function Countdown({
  startsAt,
  initialNow,
}: {
  startsAt: string;
  initialNow: string;
}) {
  const now = useTodayNow(initialNow);
  const language = useLanguage();
  return (
    <span role="status" aria-live="polite">
      {localizedCountdown(startsAt, now, language)}
    </span>
  );
}
