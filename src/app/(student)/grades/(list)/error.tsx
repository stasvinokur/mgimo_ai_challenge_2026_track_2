"use client";

import { RotateCcw, Unplug } from "lucide-react";
import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/primitives/empty-state";

export default function GradesError({ reset }: { reset: () => void }) {
  const language = useLanguage();
  return (
    <div role="alert">
      <EmptyState
        icon={Unplug}
        title={t(language, gradesMessages, "loadError")}
        description={t(language, gradesMessages, "loadErrorHint")}
        action={
          <Button onClick={reset}>
            <RotateCcw aria-hidden="true" />
            {t(language, gradesMessages, "retry")}
          </Button>
        }
      />
    </div>
  );
}
