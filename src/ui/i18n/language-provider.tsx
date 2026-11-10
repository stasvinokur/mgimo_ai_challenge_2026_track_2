"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { Language } from "./language";

const LanguageContext = createContext<Language>("ru");
const DeviceLanguageContext = createContext<Language | null>(null);

export function LanguageProvider({
  language,
  children,
}: {
  language: Language;
  children: ReactNode;
}) {
  const deviceLanguage = useContext(DeviceLanguageContext) ?? language;
  // The server value stays unchanged while streamed pages hydrate.
  return (
    <DeviceLanguageContext.Provider value={deviceLanguage}>
      <LanguageContext.Provider value={language}>
        {children}
      </LanguageContext.Provider>
    </DeviceLanguageContext.Provider>
  );
}

export function useDeviceLanguage(): Language {
  return useContext(DeviceLanguageContext) ?? "ru";
}

export function useLanguage(): Language {
  return useContext(LanguageContext);
}
