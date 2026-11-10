"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { shellMessages } from "@/ui/i18n/dictionaries/shell";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { appStorageName } from "@/ui/shared/app-path.mjs";

import {
  getInstallPrompt,
  type InstallPrompt,
  rememberInstallPrompt,
} from "./pwa-client";

const DISMISSED_KEY = appStorageName("pulse-install-dismissed");

export function PwaInstall() {
  const language = useLanguage();
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      /* Storage may be disabled. */
    }
    const standalone =
      matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone;
    if (dismissed || standalone) return;
    setHidden(false);
    setPrompt(getInstallPrompt());
    const ua = navigator.userAgent;
    setIos(
      (/iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) &&
        /Safari/.test(ua) &&
        !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua),
    );
    function ready(event: Event) {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    }
    function installed() {
      setHidden(true);
    }
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* Keep dismissal for this visit. */
    }
  }
  async function install() {
    if (!prompt) return;
    try {
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === "accepted") setHidden(true);
      setPrompt(null);
      rememberInstallPrompt(null);
    } catch {
      setError(true);
    }
  }
  if (hidden || (!ios && !prompt)) return null;
  return (
    <section
      aria-labelledby="pwa-install-label"
      className="mb-4 rounded-xl border border-border bg-card p-4 [overflow-wrap:normal] [word-break:normal]"
      data-pwa-install
    >
      <span id="pwa-install-label" className="sr-only">
        {t(language, shellMessages, "installRegion")}
      </span>
      <div className="flex items-start gap-3">
        <Download
          size={20}
          aria-hidden="true"
          className="mt-3 shrink-0 text-primary"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <p id="pwa-install-title" className="font-medium">
            {t(language, shellMessages, "installTitle")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(language, shellMessages, "installDescription")}
          </p>
          {ios ? (
            <p className="text-sm">
              {t(language, shellMessages, "installIos")}
            </p>
          ) : (
            <Button
              onClick={() => {
                void install();
              }}
            >
              {t(language, shellMessages, "install")}
            </Button>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t(language, shellMessages, "installError")}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={dismiss}
          aria-label={t(language, shellMessages, "installDismiss")}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
