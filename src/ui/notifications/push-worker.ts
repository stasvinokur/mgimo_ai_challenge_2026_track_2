/// <reference lib="webworker" />

import {
  isInternalNotificationLink,
  safePushBody,
} from "@/application/notifications/push-links";
import {
  absoluteAppUrl,
  appPath,
  withoutBasePath,
} from "@/ui/shared/app-path.mjs";

function internalUrl(link: unknown, origin: string): URL | null {
  if (typeof link !== "string" || !isInternalNotificationLink(link))
    return null;
  try {
    const url = new URL(link, origin);
    return url.origin === origin && withoutBasePath(url.pathname) !== null
      ? url
      : null;
  } catch {
    return null;
  }
}

async function showPush(worker: ServiceWorkerGlobalScope, event: PushEvent) {
  let payload: unknown;
  try {
    payload = event.data?.json();
  } catch {
    console.warn("PUSH_PAYLOAD_INVALID");
  }
  const data = payload !== null && typeof payload === "object" ? payload : {};
  const link =
    internalUrl("link" in data ? data.link : null, worker.location.origin) ??
    new URL(absoluteAppUrl(worker.location.origin, "/notifications"));
  await worker.registration.showNotification("Пульс", {
    body: safePushBody("body" in data ? data.body : null),
    icon: appPath("/icons/icon-192.png"),
    data: { link: link.pathname + link.search + link.hash },
  });
}

async function openNotification(
  worker: ServiceWorkerGlobalScope,
  notification: Notification,
) {
  const data: unknown = notification.data;
  const link =
    data !== null && typeof data === "object" && "link" in data
      ? data.link
      : null;
  const target = internalUrl(link, worker.location.origin);
  if (!target) return;
  const windows = await worker.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const ownWindows = windows.filter((client) => {
    try {
      const url = new URL(client.url);
      return (
        url.origin === worker.location.origin &&
        withoutBasePath(url.pathname) !== null
      );
    } catch {
      return false;
    }
  });
  const exact = ownWindows.find((client) => client.url === target.href);
  if (exact) {
    await exact.focus();
    return;
  }
  const current = ownWindows[0];
  if (current) {
    try {
      const navigated = await current.navigate(target.href);
      if (navigated) {
        await navigated.focus();
        return;
      }
    } catch {
      console.warn("PUSH_NAVIGATE_FAILED");
    }
  }
  await worker.clients.openWindow(target.href);
}

export function registerPushHandlers(worker: ServiceWorkerGlobalScope) {
  worker.addEventListener("push", (event) => {
    event.waitUntil(
      showPush(worker, event).catch(() => {
        console.warn("PUSH_DISPLAY_FAILED");
      }),
    );
  });
  worker.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(
      openNotification(worker, event.notification).catch(() => {
        console.warn("PUSH_OPEN_FAILED");
      }),
    );
  });
}
