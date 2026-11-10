"use client";

// Configure schemas before any client screen can validate data.
import "@/ui/assistant/client-schemas";

import type { ReactNode } from "react";
import { shellMessages } from "@/ui/i18n/dictionaries/shell";
import type { Language } from "@/ui/i18n/language";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import type { AccessibilitySettings } from "@/ui/settings/accessibility";
import { SettingsProvider } from "@/ui/settings/settings-provider";
import { ThemeToaster } from "@/ui/shell/theme-toaster";

export function Providers({
  children,
  settings,
  language,
}: {
  children: ReactNode;
  nonce?: string;
  settings: AccessibilitySettings;
  language: Language;
}) {
  return (
    <>
      <LanguageProvider language={language}>
        <SettingsProvider initialSettings={settings}>
          {children}
        </SettingsProvider>
      </LanguageProvider>
      <ThemeToaster
        position="top-center"
        offset={80}
        mobileOffset={80}
        toastOptions={{
          className: "pulse-toast",
          closeButtonAriaLabel: t(language, shellMessages, "closeNotification"),
        }}
        containerAriaLabel={t(language, shellMessages, "appNotifications")}
      />
    </>
  );
}
