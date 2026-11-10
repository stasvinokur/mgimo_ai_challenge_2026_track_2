import { appStorageName, basePath } from "@/ui/shared/app-path.mjs";

export function isLegacyRootCache(name: string, origin: string) {
  if (
    basePath() &&
    (name.startsWith(`${appStorageName("pulse-pages")}-v1-`) ||
      name === appStorageName("pulse-session-state-v1"))
  )
    return false;
  return (
    name.startsWith("pulse-pages-v1-") ||
    name === "pulse-session-state-v1" ||
    (name.startsWith("serwist-") && name.endsWith(`${origin}/`))
  );
}

export async function clearLegacyRootCaches(
  storage: CacheStorage,
  origin: string,
) {
  if (!basePath()) return;
  const names = await storage.keys();
  await Promise.all(
    names
      .filter((name) => isLegacyRootCache(name, origin))
      .map((name) => storage.delete(name)),
  );
}

export async function updateLegacyRootWorker(origin = window.location.origin) {
  if (!basePath() || !navigator.serviceWorker.getRegistrations) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const script = `${origin}/sw.js`;
  for (const registration of registrations) {
    const workers = [
      registration.active,
      registration.waiting,
      registration.installing,
    ].filter((worker): worker is ServiceWorker => Boolean(worker));
    if (
      registration.scope === `${origin}/` &&
      workers.length > 0 &&
      workers.every((worker) => worker.scriptURL === script)
    )
      await registration.update();
  }
}
