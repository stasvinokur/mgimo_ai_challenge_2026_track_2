"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  type AccessibilityKey,
  type AccessibilitySettings,
  accessibilityCookie,
  accessibilityOptions,
} from "@/ui/settings/accessibility";

const SettingsContext = createContext<{
  settings: AccessibilitySettings;
  toggle: (key: AccessibilityKey) => void;
} | null>(null);

export function SettingsProvider({
  initialSettings,
  children,
}: {
  initialSettings: AccessibilitySettings;
  children: ReactNode;
}) {
  // Mount-time context updates can restart pending streamed pages on the client.
  const [settings, setSettings] = useState(initialSettings);
  const toggle = useCallback(
    (key: AccessibilityKey) => {
      const enabled = !settings[key];
      const option = accessibilityOptions.find((option) => option.key === key);
      if (!option) return;
      // biome-ignore lint/suspicious/noDocumentCookie: Persist closed values synchronously before navigation, including on HTTP.
      document.cookie = accessibilityCookie(
        key,
        enabled,
        window.location.protocol === "https:",
      );
      document.documentElement.classList.toggle(option.className, enabled);
      setSettings({ ...settings, [key]: enabled });
    },
    [settings],
  );
  const value = useMemo(() => ({ settings, toggle }), [settings, toggle]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useAccessibilitySettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("Настройки интерфейса недоступны");
  return context;
}
