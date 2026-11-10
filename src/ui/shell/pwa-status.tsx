"use client";

import { Wifi, WifiOff } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { shellMessages } from "@/ui/i18n/dictionaries/shell";
import { formatDate } from "@/ui/i18n/format";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { appPath } from "@/ui/shared/app-path.mjs";
import {
  PAGE_CACHE_PREFIX,
  SAVED_AT_HEADER,
  type SnapshotReason,
} from "./pwa-cache";
import { warmPwaPage } from "./pwa-client";
import { shouldReloadPwaSnapshot } from "./pwa-online";
import { isPulseWorker, readyPwaRegistration } from "./pwa-scope";

export function PwaStatus() {
  const language = useLanguage();
  const pathname = usePathname();
  const snapshotPath = useRef(pathname);
  const leaving = useRef(false);
  const [snapshot, setSnapshot] = useState<{
    savedAt: string;
    reason: SnapshotReason;
  } | null>(null);
  useEffect(() => {
    if (snapshotPath.current !== pathname) {
      delete document.documentElement.dataset.pwaSavedAt;
      delete document.documentElement.dataset.pwaSnapshotReason;
      snapshotPath.current = pathname;
      leaving.current = false;
    }
    let active = true;
    let warming = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    async function status() {
      const snapshotAt = document.documentElement.dataset.pwaSavedAt;
      if (navigator.onLine && !snapshotAt) {
        setSnapshot(null);
        return;
      }
      let at = snapshotAt;
      if (!at && "caches" in window) {
        const name = (await caches.keys()).find((name) =>
          name.startsWith(PAGE_CACHE_PREFIX),
        );
        if (name)
          at =
            (
              await (await caches.open(name)).match(appPath(pathname))
            )?.headers.get(SAVED_AT_HEADER) ?? undefined;
      }
      const reason =
        navigator.onLine &&
        document.documentElement.dataset.pwaSnapshotReason === "slow"
          ? "slow"
          : "offline";
      if (active)
        setSnapshot(
          at && Number.isFinite(Date.parse(at))
            ? { savedAt: at, reason }
            : null,
        );
    }
    function offline() {
      void status().catch(() => undefined);
    }
    function canReload() {
      return (
        active &&
        shouldReloadPwaSnapshot({
          hasSnapshot: Boolean(document.documentElement.dataset.pwaSavedAt),
          online: navigator.onLine,
          visible: document.visibilityState === "visible",
          leaving: leaving.current,
        })
      );
    }
    function online() {
      if (canReload()) warmSnapshot();
      else if (navigator.onLine && !document.documentElement.dataset.pwaSavedAt)
        setSnapshot(null);
    }
    function leave() {
      leaving.current = true;
      clearTimeout(retry);
    }
    function restore(event: PageTransitionEvent) {
      if (event.persisted) {
        leaving.current = false;
        warmSnapshot();
      }
    }
    function navigate(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (!link || link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href);
      if (
        url.origin !== location.origin ||
        (url.pathname === location.pathname && url.hash)
      )
        return;
      if (navigator.onLine) {
        if (
          url.pathname !== location.pathname ||
          url.search !== location.search
        )
          leave();
        return;
      }
      // Next's RSC requests stay network-only; offline navigation needs a full HTML document.
      event.preventDefault();
      event.stopPropagation();
      leave();
      location.assign(url.href);
    }
    async function warm() {
      if (
        !("serviceWorker" in navigator) ||
        !["/today", "/schedule"].includes(pathname)
      )
        return;
      if (!(await readyPwaRegistration(location.origin))) return;
      if (
        !active ||
        !navigator.onLine ||
        leaving.current ||
        !isPulseWorker(navigator.serviceWorker.controller, location.origin)
      )
        return;
      const fresh = await warmPwaPage(`${location.pathname}${location.search}`);
      // online may arrive before the worker's network recovers, or before this copy mounts.
      if (fresh && canReload()) {
        leave();
        location.reload();
      }
    }
    function retrySnapshot() {
      if (
        active &&
        document.documentElement.dataset.pwaSavedAt &&
        document.visibilityState === "visible" &&
        !leaving.current
      )
        retry = setTimeout(warmSnapshot, 1000);
    }
    function warmSnapshot() {
      clearTimeout(retry);
      if (
        warming ||
        !active ||
        leaving.current ||
        document.visibilityState !== "visible"
      )
        return;
      if (!navigator.onLine) {
        // The event may precede navigator.onLine; recheck without making an offline request.
        retrySnapshot();
        return;
      }
      warming = true;
      void warm()
        .catch(() => console.warn("PWA_SNAPSHOT_WARM_FAILED"))
        .finally(() => {
          warming = false;
          retrySnapshot();
        });
    }
    offline();
    warmSnapshot();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", leave);
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", warmSnapshot);
    document.addEventListener("click", navigate, true);
    navigator.serviceWorker?.addEventListener("controllerchange", warmSnapshot);
    return () => {
      active = false;
      clearTimeout(retry);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", restore);
      document.removeEventListener("visibilitychange", warmSnapshot);
      document.removeEventListener("click", navigate, true);
      navigator.serviceWorker?.removeEventListener(
        "controllerchange",
        warmSnapshot,
      );
    };
  }, [pathname]);

  if (!snapshot) return null;
  const date = formatDate(language, snapshot.savedAt, {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const Icon = snapshot.reason === "slow" ? Wifi : WifiOff;
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-secondary p-4 text-sm [overflow-wrap:normal] [word-break:normal]"
      data-pwa-offline={snapshot.reason === "offline" ? "" : undefined}
      data-pwa-slow={snapshot.reason === "slow" ? "" : undefined}
    >
      <Icon size={20} aria-hidden="true" />
      <p className="min-w-0 flex-1">
        {t(language, shellMessages, "savedVersion", {
          status: t(
            language,
            shellMessages,
            snapshot.reason === "slow" ? "slowNetwork" : "offline",
          ),
          date,
        })}
      </p>
      <Button variant="outline" onClick={() => location.reload()}>
        {t(language, shellMessages, "refresh")}
      </Button>
    </div>
  );
}
