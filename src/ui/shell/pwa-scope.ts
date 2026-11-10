import { appPath } from "@/ui/shared/app-path.mjs";

export function isPulseWorker(
  worker: ServiceWorker | null | undefined,
  origin: string,
) {
  if (!worker) return false;
  try {
    const url = new URL(worker.scriptURL);
    return (
      url.origin === origin && url.pathname === appPath("/sw.js") && !url.hash
    );
  } catch {
    return false;
  }
}

export function isPulseRegistration(
  registration: ServiceWorkerRegistration | undefined,
  origin: string,
) {
  return registration?.scope === new URL(appPath("/"), origin).href;
}

export async function ownPwaRegistration(origin = window.location.origin) {
  const registration = await navigator.serviceWorker.getRegistration(
    appPath("/"),
  );
  return isPulseRegistration(registration, origin) ? registration : undefined;
}

export async function readyPwaRegistration(origin = window.location.origin) {
  const registration = await ownPwaRegistration(origin);
  if (registration?.active && isPulseWorker(registration.active, origin))
    return registration;
  const ready = await navigator.serviceWorker.ready;
  return isPulseRegistration(ready, origin) &&
    isPulseWorker(ready.active, origin)
    ? ready
    : undefined;
}
