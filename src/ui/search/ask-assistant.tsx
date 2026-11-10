"use client";

import { searchMessages } from "@/ui/i18n/dictionaries/search";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { openAssistant } from "@/ui/shell/assistant-entry";

export function AskAssistant() {
  const language = useLanguage();
  return (
    <Button type="button" variant="outline" onClick={() => openAssistant()}>
      {t(language, searchMessages, "assistant")}
    </Button>
  );
}
