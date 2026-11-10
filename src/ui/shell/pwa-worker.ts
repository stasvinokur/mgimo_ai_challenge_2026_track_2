/// <reference lib="webworker" />

import { type PrecacheEntry, Serwist, type SerwistGlobalConfig } from "serwist";
import { appPath, withoutBasePath } from "@/ui/shared/app-path.mjs";
import { registerPushHandlers } from "../notifications/push-worker";
import {
  endsPageSession,
  isPageSnapshot,
  offlineSnapshot,
  PwaPageCache,
  type SnapshotReason,
} from "./pwa-cache";
import { clearLegacyRootCaches } from "./pwa-legacy";

declare const self: ServiceWorkerGlobalScope &
  SerwistGlobalConfig & {
    __SW_MANIFEST: (PrecacheEntry | string)[];
    __PULSE_BUILD_ID: string;
  };

const pages = new PwaPageCache(
  caches,
  self.location.origin,
  self.__PULSE_BUILD_ID,
);
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  // Never preload RSC or adopt the framework's broad default runtime caches.
  navigationPreload: false,
  runtimeCaching: [
    {
      matcher: ({ url }) =>
        url.origin === self.location.origin &&
        withoutBasePath(url.pathname) !== null,
      handler: async ({ request, event, url }) => {
        if (url.pathname === appPath("/login"))
          event.waitUntil(pages.clear().catch(() => undefined));
        const started = pages.startRequest();
        const snapshot = isPageSnapshot(request, self.location.origin);
        const network = fetch(request).then(
          (response) => {
            try {
              const update =
                snapshot && endsPageSession(response, self.location.origin)
                  ? pages.clear()
                  : snapshot
                    ? pages.save(request, response.clone(), started)
                    : pages.observe(response, started);
              event.waitUntil(update.catch(() => undefined));
            } catch {
              // Snapshot failures must not turn a successful fetch into offline.
            }
            return { response };
          },
          () => ({ response: null }),
        );
        event.waitUntil(network);
        async function saved(reason: SnapshotReason) {
          try {
            const cached = await pages.read(url.pathname);
            const response = cached
              ? await offlineSnapshot(cached, reason)
              : undefined;
            return started.generation === pages.generation
              ? response
              : undefined;
          } catch {
            return undefined;
          }
        }
        let timer: number | undefined;
        try {
          const first = snapshot
            ? await Promise.race([
                network,
                new Promise<undefined>((resolve) => {
                  timer = self.setTimeout(resolve, 3000);
                }),
              ])
            : await network;
          if (!first) {
            const response = await saved("slow");
            if (response) return response;
          }
          const result = first ?? (await network);
          if (result.response) return result.response;
          // Only a rejected fetch reaches the offline response path.
          if (snapshot) {
            const response = await saved("offline");
            if (response) return response;
          }
          if (
            request.mode === "navigate" &&
            !url.pathname.startsWith(appPath("/api/")) &&
            !request.headers.has("RSC") &&
            !request.headers.has("Next-Action")
          ) {
            const fallback = await serwist.matchPrecache(
              appPath("/offline.html"),
            );
            if (fallback) return fallback;
          }
          return Response.error();
        } finally {
          self.clearTimeout(timer);
        }
      },
    },
  ],
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    clearLegacyRootCaches(caches, self.location.origin).catch(() =>
      console.warn("PWA_LEGACY_CACHE_CLEAR_FAILED"),
    ),
  );
  event.waitUntil(
    pages.activate().catch(() => {
      console.warn("PWA_BUILD_SNAPSHOTS_UNAVAILABLE");
    }),
  );
});

// POST/Server Actions always use the network and invalidate any older personal snapshot.
self.addEventListener("fetch", (event) => {
  if (
    event.request.method === "GET" ||
    new URL(event.request.url).origin !== self.location.origin ||
    withoutBasePath(new URL(event.request.url).pathname) === null
  )
    return;
  event.respondWith(
    pages
      .invalidate()
      .catch(() => undefined)
      .then(() => fetch(event.request)),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type !== "PULSE_CLEAR_PAGES") return;
  event.waitUntil(
    pages.clear().then(
      () => event.ports[0]?.postMessage({ ok: true }),
      () => event.ports[0]?.postMessage({ ok: false }),
    ),
  );
});
registerPushHandlers(self);
serwist.addEventListeners();
