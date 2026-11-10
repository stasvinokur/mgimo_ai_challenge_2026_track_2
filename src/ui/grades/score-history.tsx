"use client";

import type { ScoreHistoryDto } from "@/application/grades/history";
import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { formatGradeDate, formatScore } from "./format";

export function ScoreHistory({
  entries,
}: {
  entries: ScoreHistoryDto["entries"];
}) {
  const language = useLanguage();
  return (
    <section
      className="space-y-3 [overflow-wrap:normal]"
      aria-label={t(language, gradesMessages, "scoreHistory")}
    >
      <h2>{t(language, gradesMessages, "scoreHistory")}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(language, gradesMessages, "historyEmpty")}
        </p>
      ) : (
        <ol className="space-y-4">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="space-y-1 border-t border-border pt-3 text-sm"
            >
              <p className="font-medium">{entry.assessmentTitle}</p>
              <p className="font-semibold tabular-nums">
                {entry.previousScore === null
                  ? t(language, gradesMessages, "notGraded")
                  : formatScore(entry.previousScore, language)}{" "}
                → {formatScore(entry.newScore, language)}
              </p>
              {entry.reason && (
                <p className="whitespace-pre-wrap">
                  {t(language, gradesMessages, `reason_${entry.reason}`)}
                </p>
              )}
              <p className="text-muted-foreground">
                <time dateTime={entry.createdAt}>
                  {formatGradeDate(entry.createdAt, language)}
                </time>{" "}
                {t(language, gradesMessages, "moscow")} ·{" "}
                {t(language, gradesMessages, "changedTeacher")}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
