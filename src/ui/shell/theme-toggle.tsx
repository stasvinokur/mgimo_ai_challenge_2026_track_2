"use client";

import { Moon, Sun } from "lucide-react";
import { shellMessages } from "@/ui/i18n/dictionaries/shell";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { toggleTheme } from "@/ui/shell/theme";

export function ThemeToggle() {
  const language = useLanguage();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t(language, shellMessages, "themeToggle")}
      title={t(language, shellMessages, "themeToggle")}
      onClick={toggleTheme}
    >
      <Moon className="size-5 dark:hidden" aria-hidden="true" />
      <Sun className="hidden size-5 dark:block" aria-hidden="true" />
    </Button>
  );
}
