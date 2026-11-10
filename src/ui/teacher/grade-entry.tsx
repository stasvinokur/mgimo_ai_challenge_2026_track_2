"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useState } from "react";
import {
  type GradeActionState,
  setGrade,
} from "@/app/(teacher)/teacher/grades/actions";
import { reasonOptions } from "@/application/grades/score-reasons";
import { Button } from "@/ui/primitives/button";

export function GradeEntry({
  lesson,
  entryKey,
  studentName,
  workTitle,
  maxScore,
  initialScore,
}: {
  lesson: { slotId: string; occurrenceDate: string };
  entryKey: string;
  studentName: string;
  workTitle: string;
  maxScore: number;
  initialScore: number | null;
}) {
  const id = useId();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [score, setScore] = useState(String(initialScore ?? ""));
  const [state, action, pending] = useActionState<GradeActionState, FormData>(
    setGrade.bind(null, lesson),
    { status: "idle", message: "" },
  );
  useEffect(() => setHydrated(true), []);
  useEffect(() => setScore(String(initialScore ?? "")), [initialScore]);
  const needsReason = initialScore !== null && Number(score) !== initialScore;
  const scoreErrors = state.fieldErrors?.score;
  const reasonErrors = state.fieldErrors?.reason;
  return (
    <form
      action={action}
      aria-label={`${studentName} — ${workTitle}`}
      aria-busy={pending}
      data-hydrated={hydrated}
      className="teacher-gradebook-entry"
    >
      <input type="hidden" name="entryKey" value={entryKey} />
      <input type="hidden" name="expectedScore" value={initialScore ?? ""} />
      <p className="text-sm text-muted-foreground">
        Сейчас:{" "}
        {initialScore === null
          ? "не выставлен"
          : `${initialScore} из ${maxScore}`}
      </p>
      <div className="space-y-1">
        <label htmlFor={`${id}-score`} className="teacher-gradebook-label">
          Балл
        </label>
        <input
          id={`${id}-score`}
          name="score"
          type="number"
          inputMode="numeric"
          min={0}
          max={maxScore}
          step={1}
          required
          value={score}
          onChange={(event) => setScore(event.target.value)}
          aria-invalid={Boolean(scoreErrors?.length)}
          aria-describedby={`${id}-range${scoreErrors?.length ? ` ${id}-score-error` : ""}`}
          className="teacher-gradebook-input"
        />
        <p id={`${id}-range`} className="text-xs text-muted-foreground">
          От 0 до {maxScore}, целое число
        </p>
        {scoreErrors?.length ? (
          <p id={`${id}-score-error`} className="text-sm text-destructive">
            {scoreErrors.join(" ")}
          </p>
        ) : null}
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-reason`} className="teacher-gradebook-label">
          Причина изменения
        </label>
        <select
          id={`${id}-reason`}
          name="reason"
          defaultValue=""
          required={needsReason}
          aria-invalid={Boolean(reasonErrors?.length)}
          aria-describedby={`${id}-reason-hint${reasonErrors?.length ? ` ${id}-reason-error` : ""}`}
          className="teacher-gradebook-input"
        >
          <option value="">Выберите причину</option>
          {reasonOptions.map(({ code, label }) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <p id={`${id}-reason-hint`} className="text-xs text-muted-foreground">
          Для исправления балла обязательна. Студент увидит выбранную причину.
        </p>
        {reasonErrors?.length ? (
          <p id={`${id}-reason-error`} className="text-sm text-destructive">
            {reasonErrors.join(" ")}
          </p>
        ) : null}
      </div>
      <Button
        type="submit"
        disabled={pending}
        className="teacher-gradebook-button max-w-full [overflow-wrap:normal]"
      >
        {pending ? "Сохраняем…" : "Сохранить балл"}
      </Button>
      <p
        role={state.status === "error" ? "alert" : "status"}
        className={
          state.status === "error"
            ? "text-sm text-destructive"
            : "text-sm text-muted-foreground"
        }
      >
        {state.message}
      </p>
      {state.code === "CONFLICT" && (
        <Button
          className="teacher-gradebook-button"
          type="button"
          variant="outline"
          onClick={() => router.refresh()}
        >
          Обновить ведомость
        </Button>
      )}
    </form>
  );
}
