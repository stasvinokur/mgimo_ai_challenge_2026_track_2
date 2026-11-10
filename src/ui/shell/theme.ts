import { appStorageName } from "@/ui/shared/app-path.mjs";

export type ResolvedTheme = "light" | "dark";

const themeChangeEvent = "pulse:theme-change";
const themeStorageKey = appStorageName("pulse-theme");

// Keep this function self-contained: it also runs before hydration as an inline script.
export function applyTheme(
  preference?: unknown,
  storageKey = "pulse-theme",
): ResolvedTheme {
  if (preference === undefined) {
    try {
      preference = window.localStorage.getItem(storageKey);
    } catch {
      console.warn("THEME_STORAGE_READ_FAILED");
    }
  }
  const theme =
    preference === "dark" || preference === "light"
      ? preference
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
  return theme;
}

export const themeScript = `(${applyTheme.toString()})(undefined,${JSON.stringify(themeStorageKey)});`;

export function toggleTheme() {
  const theme = document.documentElement.classList.contains("dark")
    ? "light"
    : "dark";
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    console.warn("THEME_STORAGE_WRITE_FAILED");
  }
  applyTheme(theme, themeStorageKey);
  window.dispatchEvent(new CustomEvent(themeChangeEvent, { detail: theme }));
}

export function watchTheme(onChange: (theme: ResolvedTheme) => void) {
  let preference: unknown;
  const refresh = () => onChange(applyTheme(preference, themeStorageKey));
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== themeStorageKey) return;
    if (event.storageArea && event.storageArea !== window.localStorage) return;
    preference = event.newValue ?? "system";
    refresh();
  };
  const onSelection = (event: Event) => {
    preference = (event as CustomEvent<unknown>).detail;
    refresh();
  };

  media.addEventListener("change", refresh);
  window.addEventListener("storage", onStorage);
  window.addEventListener(themeChangeEvent, onSelection);
  refresh();
  return () => {
    media.removeEventListener("change", refresh);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(themeChangeEvent, onSelection);
  };
}
