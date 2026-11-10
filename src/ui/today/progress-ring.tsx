import type { CSSProperties } from "react";
import { todayMessages } from "@/ui/i18n/dictionaries/today";
import { formatNumber } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";
import { calculateProgressRing } from "@/ui/primitives/progress-ring-layout";
import type { SemanticTone } from "@/ui/primitives/stage-bar";

export function TodayProgressRing({
  value,
  goal,
  tone,
  language,
}: {
  value: number;
  goal: number;
  tone: SemanticTone;
  language: Language;
}) {
  const ring = calculateProgressRing(value, goal);
  const options = { maximumFractionDigits: 1 };
  const valueLabel = Number.isFinite(value)
    ? formatNumber(language, value, options)
    : "—";
  const goalLabel = formatNumber(language, ring.goal, options);
  return (
    <div
      className="progress-ring"
      data-tone={tone}
      style={{ "--progress-ink": `var(--${tone}-ink)` } as CSSProperties}
      role="img"
      aria-label={t(language, todayMessages, "ring", {
        value: valueLabel,
        goal: goalLabel,
      })}
    >
      <svg viewBox="0 0 72 72" aria-hidden="true" focusable="false">
        <circle className="progress-ring-track" cx="36" cy="36" r="30" />
        {ring.ratio > 0 && (
          <circle
            className="progress-ring-value"
            cx="36"
            cy="36"
            r="30"
            strokeDasharray={ring.circumference}
            strokeDashoffset={ring.offset}
            transform="rotate(-90 36 36)"
          />
        )}
      </svg>
      <span className="progress-ring-number" aria-hidden="true">
        {valueLabel}
      </span>
      <span className="progress-ring-goal" aria-hidden="true">
        {t(language, todayMessages, "outOf", { goal: goalLabel })}
      </span>
    </div>
  );
}
