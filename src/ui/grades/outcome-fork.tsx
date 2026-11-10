"use client";

import type { WorkOutcomesDto } from "@/application/grades/calculation";
import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { cn } from "@/ui/primitives/utils";
import { formatScore, gradeLabel } from "./format";

export function OutcomeFork({
  outcomes,
  selected,
  compact = false,
}: {
  outcomes: WorkOutcomesDto;
  selected?: "submit" | "skip";
  compact?: boolean;
}) {
  const language = useLanguage();
  const tr = (
    key: keyof typeof gradesMessages,
    params: Record<string, string | number> = {},
  ) => t(language, gradesMessages, key, params);
  const scoreText = (value: number) => formatScore(value, language);
  const branches = [
    {
      key: "submit",
      label: tr("forkSubmit", {
        score: scoreText(outcomes.submitted.score),
        max: scoreText(outcomes.maxScore),
      }),
      ...outcomes.submitted,
    },
    { key: "skip", label: tr("skip"), ...outcomes.skipped },
  ] as const;
  return (
    <div
      data-testid="grade-outcome-fork"
      data-compact={compact}
      className="@container min-w-0 text-sm [overflow-wrap:normal]"
    >
      <div className="flex @md:justify-center">
        <p
          data-testid="fork-current"
          className="rounded-lg border border-border bg-background px-3 py-2 text-muted-foreground"
        >
          {tr("forkCurrent", { score: scoreText(outcomes.currentTotal) })}
        </p>
      </div>
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        className="hidden h-8 w-full text-muted-foreground @md:block"
      >
        <path
          d="M50 0V12M25 32V12H75V32"
          fill="none"
          stroke="currentColor"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="relative grid auto-rows-fr gap-3 pt-3 pl-6 @md:grid-cols-2 @md:pt-0 @md:pl-0">
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 100"
          preserveAspectRatio="none"
          className="absolute top-0 left-0 h-full w-6 text-muted-foreground @md:hidden"
        >
          <path
            d="M4 0V75H21M4 25H21M18 23L21 25L18 27M18 73L21 75L18 77"
            fill="none"
            stroke="currentColor"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {branches.map((branch) => (
          <div
            key={branch.key}
            data-testid={`fork-${branch.key}`}
            data-selected={selected === branch.key}
            className={cn(
              "min-w-0 space-y-2 rounded-lg border bg-background p-3",
              selected === branch.key
                ? "border-primary ring-1 ring-primary"
                : "border-border",
              compact && "space-y-1",
            )}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p data-testid="fork-label" className="font-medium">
                {branch.label}
              </p>
              {selected === branch.key && (
                <span className="whitespace-nowrap rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                  {tr("selected")}
                </span>
              )}
            </div>
            <p data-testid="fork-total" className="font-semibold tabular-nums">
              {tr("forkTotal", { score: scoreText(branch.total) })}
            </p>
            <p>{gradeLabel(branch.grade, language)}</p>
            <p className="text-xs text-muted-foreground">
              {tr("forkTarget", {
                target: scoreText(outcomes.target),
                result: tr(
                  branch.reachesTarget ? "targetReached" : "targetNotReached",
                ),
              })}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
