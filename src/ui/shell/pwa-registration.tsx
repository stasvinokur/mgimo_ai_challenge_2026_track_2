"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { appPath } from "@/ui/shared/app-path.mjs";
import {
  clearPwaPages,
  type InstallPrompt,
  rememberInstallPrompt,
  watchPwaInstallation,
} from "./pwa-client";
import { updateLegacyRootWorker } from "./pwa-legacy";

export function PwaRegistration() {
  const pathname = usePathname();
  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" &&
      "serviceWorker" in navigator &&
      !new URLSearchParams(location.search).has("nosw")
    )
      void updateLegacyRootWorker().catch(() =>
        console.warn("PWA_LEGACY_UPDATE_FAILED"),
      );
  }, []);
  useEffect(() => {
    function ready(event: Event) {
      event.preventDefault();
      rememberInstallPrompt(event as InstallPrompt);
    }
    function installed() {
      rememberInstallPrompt(null);
    }
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  useEffect(() => {
    if (pathname === "/login")
      void clearPwaPages().catch(() => console.warn("PWA_CACHE_CLEAR_FAILED"));
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator) ||
      new URLSearchParams(location.search).has("nosw")
    )
      return;
    let active = true;
    let stop: (() => void) | undefined;
    void navigator.serviceWorker
      .register(appPath("/sw.js"), {
        scope: appPath("/"),
        updateViaCache: "none",
        type: "module",
      })
      .then((registration) => {
        if (active) stop = watchPwaInstallation(registration);
      })
      .catch(() => console.warn("PWA_SW_REGISTRATION_FAILED"));
    return () => {
      active = false;
      stop?.();
    };
  }, [pathname]);
  return null;
}
