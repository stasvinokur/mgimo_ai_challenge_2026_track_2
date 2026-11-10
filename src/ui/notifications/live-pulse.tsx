"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import type { PulseDto } from "@/application/notifications/ports";
import { notificationsMessages } from "@/ui/i18n/dictionaries/notifications";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { appPath } from "@/ui/shared/app-path.mjs";
import { PulseHttpError, startPulsePolling } from "./pulse-poller";

export function LivePulse({
  initial,
  latestTitle,
}: {
  initial: PulseDto | null;
  latestTitle(input: {
    latestAt: string;
  }): Promise<{ latestTitle: string | null }>;
}) {
  const router = useRouter();
  const language = useLanguage();
  useEffect(() => {
    let active = true;
    const stop = startPulsePolling({
      initial,
      visible: () => document.visibilityState === "visible",
      subscribe(listener) {
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
      },
      async load(signal) {
        const response = await fetch(appPath("/api/me/pulse"), {
          cache: "no-store",
          signal,
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {
            console.warn("PULSE_RESPONSE_CANCEL_FAILED");
          });
          throw new PulseHttpError(response.status);
        }
        const data: unknown = await response.json();
        if (
          !data ||
          typeof data !== "object" ||
          !("unread" in data) ||
          !("latestAt" in data) ||
          !Number.isInteger(data.unread) ||
          typeof data.unread !== "number" ||
          data.unread < 0 ||
          !(
            data.latestAt === null ||
            (typeof data.latestAt === "string" &&
              Number.isFinite(Date.parse(data.latestAt)))
          )
        ) {
          throw new Error("Пульс недоступен.");
        }
        return { unread: data.unread, latestAt: data.latestAt };
      },
      unauthorized() {
        if (active) router.refresh();
      },
      async changed(pulse, previous) {
        let title: string | null = null;
        try {
          if (
            previous &&
            pulse.latestAt &&
            (!previous.latestAt || pulse.latestAt > previous.latestAt)
          ) {
            title = (await latestTitle({ latestAt: pulse.latestAt }))
              .latestTitle;
          }
        } catch {
          // A missing title must not prevent refreshing student data.
        }
        if (!active || document.visibilityState !== "visible") return false;
        router.refresh();
        if (title) {
          if (language === "en") {
            toast(title, {
              description: t(language, notificationsMessages, "russianContent"),
            });
          } else toast(title);
        }
      },
    });
    return () => {
      active = false;
      stop();
    };
  }, [initial, latestTitle, router, language]);
  return null;
}
