import { appPath, appStorageName } from "@/ui/shared/app-path.mjs";

export const languages = ["ru", "en"] as const;
export type Language = (typeof languages)[number];
export const LANGUAGE_COOKIE = appStorageName("pulse-language");

export function parseLanguage(value: unknown): Language {
  return value === "en" ? "en" : "ru";
}

export function languageCookie(language: Language, secure: boolean): string {
  return `${LANGUAGE_COOKIE}=${parseLanguage(language)}; Path=${appPath("/")}; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}
