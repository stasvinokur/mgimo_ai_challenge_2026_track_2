"use client";

import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";

export function GradingExplanation() {
  const language = useLanguage();
  return (
    <details className="text-sm text-muted-foreground">
      <summary className="min-h-12 cursor-pointer py-3 font-medium text-foreground">
        {t(language, gradesMessages, "howCalculated")}
      </summary>
      <div className="space-y-2 pb-2">
        <p>{t(language, gradesMessages, "gradingAverage")}</p>
        <p>{t(language, gradesMessages, "gradingTotal")}</p>
        <p>{t(language, gradesMessages, "gradingRules")}</p>
      </div>
    </details>
  );
}
