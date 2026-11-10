import type { CSSProperties } from "react";
import { calculateProgressRing } from "./progress-ring-layout";
import type { SemanticTone } from "./stage-bar";
import { cn } from "./utils";

export function ProgressRing({
  value,
  goal,
  tone,
  className,
}: {
  value?: number | null;
  goal: number;
  tone?: SemanticTone;
  className?: string;
}) {
  const ring = calculateProgressRing(value, goal);
  return (
    <div
      className={cn("progress-ring", className)}
      data-tone={tone}
      style={
        tone
          ? ({ "--progress-ink": `var(--${tone}-ink)` } as CSSProperties)
          : undefined
      }
      role="img"
      aria-label={ring.accessibleName}
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
      <span
        className={cn(
          "progress-ring-number",
          value == null && "progress-ring-empty",
        )}
        aria-hidden="true"
      >
        {ring.valueLabel}
      </span>
      <span className="progress-ring-goal" aria-hidden="true">
        из {ring.goalLabel}
      </span>
    </div>
  );
}
