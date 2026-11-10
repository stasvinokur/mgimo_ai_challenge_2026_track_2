"use client";

import { useEffect, useId, useState } from "react";
import {
  calculateWhatIf,
  initialPredictions,
  type Predictions,
} from "@/application/grades/calculation";
import type {
  CalculatedCourseGradesDto,
  GradesMessagesDto,
} from "@/application/grades/get-my-grades";
import { calculateScholarship } from "@/application/grades/scholarship";
import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { formatScore, gradeLabel } from "./format";
import { OutcomeFork } from "./outcome-fork";
import { ScholarshipResult } from "./scholarship-forecast";

export function WhatIf({
  course,
  target,
  semester,
}: {
  course: CalculatedCourseGradesDto;
  target: number;
  semester?: Pick<GradesMessagesDto, "courses" | "scholarship">;
}) {
  const language = useLanguage();
  const tr = (
    key: keyof typeof gradesMessages,
    params: Record<string, string | number> = {},
  ) => t(language, gradesMessages, key, params);
  const scoreText = (value: number) => formatScore(value, language);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const prefix = useId();
  const [predictions, setPredictions] = useState<Predictions>(() =>
    initialPredictions(course.works, target),
  );
  const [skipped, setSkipped] = useState<Readonly<Record<string, boolean>>>({});
  const effective = Object.fromEntries(
    course.works
      .filter((work) => work.score === null)
      .map((work) => [
        work.id,
        skipped[work.id] ? 0 : (predictions[work.id] ?? 0),
      ]),
  );
  const result = calculateWhatIf(course.works, effective, target);
  if (result.remaining.length === 0) return null;
  return (
    <section
      data-what-if-ready={ready}
      aria-labelledby={`${prefix}-heading`}
      className="space-y-4 rounded-xl bg-secondary p-4 [overflow-wrap:normal]"
    >
      <div>
        <h2 id={`${prefix}-heading`} className="font-semibold">
          {tr("whatIf")}
        </h2>
        <p className="text-sm text-muted-foreground">{tr("whatIfHint")}</p>
      </div>
      {course.works
        .filter((work) => work.score === null)
        .map((work) => {
          const selectedScore = predictions[work.id] ?? 0;
          const branch = calculateWhatIf(
            course.works,
            { ...effective, [work.id]: selectedScore },
            target,
          ).remaining.find((item) => item.id === work.id);
          if (!branch) return null;
          const id = `${prefix}-${work.id}`;
          return (
            <fieldset
              key={work.id}
              className="min-w-0 space-y-3 border-t border-border pt-4"
            >
              <legend className="font-medium">{work.title}</legend>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={!skipped[work.id] ? "default" : "outline"}
                  aria-pressed={!skipped[work.id]}
                  onClick={() => setSkipped({ ...skipped, [work.id]: false })}
                >
                  {tr("submit")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={skipped[work.id] ? "default" : "outline"}
                  aria-pressed={Boolean(skipped[work.id])}
                  onClick={() => setSkipped({ ...skipped, [work.id]: true })}
                >
                  {tr("skip")}
                </Button>
              </div>
              <label htmlFor={id} className="block text-sm">
                {tr("predictedScore", {
                  score: scoreText(selectedScore),
                  max: scoreText(work.maxScore),
                })}
              </label>
              <input
                id={id}
                type="range"
                min={0}
                max={work.maxScore}
                step={1}
                value={selectedScore}
                disabled={Boolean(skipped[work.id])}
                aria-describedby={`${id}-hint`}
                aria-valuetext={tr("scoreOutOf", {
                  score: scoreText(selectedScore),
                  max: scoreText(work.maxScore),
                })}
                className="block h-12 w-full min-w-0 accent-primary"
                onChange={(event) =>
                  setPredictions({
                    ...predictions,
                    [work.id]: Number(event.target.value),
                  })
                }
              />
              <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                {tr("sliderHint")}
              </p>
              <p className="text-sm">
                {branch.minimum === null
                  ? tr("workUnreachable", { target: scoreText(target) })
                  : tr("workMinimum", {
                      minimum: scoreText(branch.minimum),
                      max: scoreText(work.maxScore),
                      target: scoreText(target),
                    })}
              </p>
              <OutcomeFork
                outcomes={branch.outcomes}
                selected={skipped[work.id] ? "skip" : "submit"}
              />
              {work.isRequired && (
                <p className="text-sm text-muted-foreground">
                  {tr("requiredWorkHint")}
                </p>
              )}
            </fieldset>
          );
        })}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="space-y-2 border-t border-border pt-4"
      >
        <p className="font-semibold">
          {tr("projectedTotal", {
            score: scoreText(result.total),
            grade: gradeLabel(result.grade, language),
          })}
        </p>
        <p className="text-sm">
          {tr("forecastCredit", {
            credit: tr(result.grade.credit ? "credit" : "noCreditYet"),
            target: scoreText(target),
            result: tr(
              result.reachesTarget ? "targetReached" : "targetNotReached",
            ),
          })}
        </p>
        {!result.targetReachable && (
          <p className="text-sm">{tr("targetUnreachable")}</p>
        )}
        {semester && (
          <div className="space-y-3 border-t border-border pt-4">
            <h3 className="font-semibold">{tr("scenarioScholarship")}</h3>
            <ScholarshipResult
              forecast={calculateScholarship(
                semester.courses,
                semester.scholarship.currentScholarship,
                {
                  courseId: course.id,
                  predictions: effective,
                  skipped,
                },
              )}
            />
          </div>
        )}
      </div>
    </section>
  );
}
