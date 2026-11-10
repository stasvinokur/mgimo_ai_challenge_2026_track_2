"use client";

import { RotateCcw, Unplug } from "lucide-react";
import { shellMessages } from "@/ui/i18n/dictionaries/shell";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/primitives/empty-state";

export function PageError({ reset }: { reset: () => void }) {
  const language = useLanguage();
  return (
    <div className="section-page [overflow-wrap:normal] [word-break:normal]">
      <h1>{t(language, shellMessages, "pageError")}</h1>
      <div role="alert">
        <EmptyState
          icon={Unplug}
          title={t(language, shellMessages, "loadError")}
          description={t(language, shellMessages, "loadErrorDescription")}
          action={
            <Button onClick={reset}>
              <RotateCcw aria-hidden="true" />
              {t(language, shellMessages, "retry")}
            </Button>
          }
        />
      </div>
    </div>
  );
}
