import { appPath, appStorageName } from "@/ui/shared/app-path.mjs";

export const accessibilityOptions = [
  {
    key: "largeText",
    cookie: appStorageName("pulse-large-text"),
    className: "a11y-large-text",
    label: "Крупный текст",
    description: "Текст и элементы интерфейса на 25% крупнее.",
  },
  {
    key: "highContrast",
    cookie: appStorageName("pulse-high-contrast"),
    className: "a11y-high-contrast",
    label: "Высокий контраст",
    description: "Более чёткие цвета текста, границ и элементов управления.",
  },
  {
    key: "reducedMotion",
    cookie: appStorageName("pulse-reduced-motion"),
    className: "a11y-reduced-motion",
    label: "Меньше движения",
    description: "Без анимаций и плавных переходов.",
  },
] as const;

export type AccessibilityKey = (typeof accessibilityOptions)[number]["key"];
export type AccessibilitySettings = Record<AccessibilityKey, boolean>;

export function parseAccessibilitySettings(
  readCookie: (name: string) => string | undefined,
): AccessibilitySettings {
  return {
    largeText: readCookie(accessibilityOptions[0].cookie) === "on",
    highContrast: readCookie(accessibilityOptions[1].cookie) === "on",
    reducedMotion: readCookie(accessibilityOptions[2].cookie) === "on",
  };
}

export function accessibilityClasses(settings: AccessibilitySettings): string {
  return accessibilityOptions
    .filter(({ key }) => settings[key])
    .map(({ className }) => className)
    .join(" ");
}

export function accessibilityCookie(
  key: AccessibilityKey,
  enabled: boolean,
  secure: boolean,
): string {
  const option = accessibilityOptions.find((option) => option.key === key);
  if (!option) throw new Error("Неизвестная настройка интерфейса");
  return `${option.cookie}=${enabled ? "on" : "off"}; Path=${appPath("/")}; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}
