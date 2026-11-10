"use client";

import { useEffect, useState } from "react";
import { settingsMessages } from "@/ui/i18n/dictionaries/settings";
import { useLanguage } from "@/ui/i18n/language-provider";
import { LanguageSelect } from "@/ui/i18n/language-select";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ui/primitives/card";
import { accessibilityOptions } from "@/ui/settings/accessibility";
import { useAccessibilitySettings } from "@/ui/settings/settings-provider";

export function SettingsCard() {
  const language = useLanguage();
  const { settings, toggle } = useAccessibilitySettings();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <section
      aria-labelledby="interface-settings-title"
      data-settings-ready={ready}
      className="min-w-0 [overflow-wrap:normal] [word-break:normal]"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="interface-settings-title">
              {t(language, settingsMessages, "title")}
            </h2>
          </CardTitle>
          <CardDescription>
            {t(language, settingsMessages, "description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-5">
          <LanguageSelect />
          {accessibilityOptions.map(({ key }) => (
            <div key={key} className="min-w-0">
              <Button
                type="button"
                role="switch"
                aria-checked={settings[key]}
                aria-describedby={`setting-${key}-description`}
                variant="outline"
                disabled={!ready}
                onClick={() => toggle(key)}
                className="h-auto w-full min-w-0 justify-between whitespace-normal text-left"
              >
                <span>{t(language, settingsMessages, key)}</span>
                <span
                  aria-hidden="true"
                  className={`flex h-7 w-12 shrink-0 items-center rounded-full border p-1 ${settings[key] ? "justify-end border-primary bg-primary" : "justify-start border-muted-foreground bg-background"}`}
                >
                  <span
                    className={`size-4 rounded-full ${settings[key] ? "bg-primary-foreground" : "bg-muted-foreground"}`}
                  />
                </span>
              </Button>
              <p
                id={`setting-${key}-description`}
                className="mt-2 text-sm text-muted-foreground"
              >
                {t(language, settingsMessages, `${key}Description`)}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
