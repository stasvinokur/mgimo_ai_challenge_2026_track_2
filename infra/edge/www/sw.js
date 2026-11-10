// Until 10.11.2026 «Пульс» ran at the root of this domain with a root-scope service worker and offline caches of the
// student's pages. It now lives in /dekanat/ (D-54). Browsers that still hold the old worker fetch this script on their
// next update check: it deletes exactly the root-era caches, unregisters itself and reloads the controlled pages once.
// Caches of «Пульс» in its folder (pulse-pages-dekanat-v1-*, pulse-session-state-v1-dekanat, Serwist with the
// /dekanat/ scope) and caches of other solutions are left alone.
const rootEra = (name) =>
  name.startsWith("pulse-pages-v1-") ||
  name === "pulse-session-state-v1" ||
  (name.startsWith("serwist-") && name.endsWith(self.registration.scope));

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter(rootEra).map((name) => caches.delete(name)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      for (const client of windows) client.navigate(client.url);
    })(),
  );
});
