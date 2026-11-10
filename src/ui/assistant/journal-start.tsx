"use client";

import { useEffect, useState } from "react";
import { assistantMessages } from "@/ui/i18n/dictionaries/assistant";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { openAssistant } from "@/ui/shell/assistant-entry";

export function JournalStart() {
  const language = useLanguage();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <Button
      disabled={!ready}
      data-journal-ready={ready ? "true" : undefined}
      onClick={() => openAssistant()}
    >
      {t(language, assistantMessages, "askAssistant")}
    </Button>
  );
}
