"use client";

import { useEffect, useId, useState } from "react";
import { languageCookie, parseLanguage } from "./language";
import { useDeviceLanguage } from "./language-provider";

export function LanguageSelect() {
  const language = useDeviceLanguage();
  const id = useId();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <div className="grid min-w-0 gap-2 [overflow-wrap:normal]">
      <label htmlFor={id} className="text-sm font-medium">
        {language === "en" ? "Language" : "Язык"}
      </label>
      <select
        id={id}
        value={language}
        disabled={!ready}
        data-language-ready={ready}
        onChange={(event) => {
          const selected = parseLanguage(event.target.value);
          if (selected === language) return;
          // biome-ignore lint/suspicious/noDocumentCookie: Persist a closed device setting before the server renders the new language.
          document.cookie = languageCookie(
            selected,
            window.location.protocol === "https:",
          );
          window.location.reload();
        }}
        className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2"
      >
        <option value="ru" lang="ru">
          Русский
        </option>
        <option value="en" lang="en">
          English
        </option>
      </select>
    </div>
  );
}
