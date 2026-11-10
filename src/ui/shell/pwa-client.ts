import { PwaPageCache, SAVED_AT_HEADER } from "./pwa-cache";
import { isPulseWorker } from "./pwa-scope";

export async function warmPwaPage(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "text/html" },
    cache: "no-store",
  });
  // An unread response keeps the active SW's fetch event open and blocks updates.
  await response.arrayBuffer();
  return (
    response.ok &&
    response.headers.get("Content-Type")?.includes("text/html") === true &&
    !response.headers.has(SAVED_AT_HEADER)
  );
}

export async function clearPwaPages() {
  try {
    const controller = navigator.serviceWorker?.controller;
    if (isPulseWorker(controller, window.location.origin) && controller) {
      await new Promise<void>((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => {
          channel.port1.close();
          reject(
            new Error(
              "Не удалось очистить сохранённые страницы. Попробуйте ещё раз.",
            ),
          );
        }, 3000);
        channel.port1.onmessage = (event) => {
          clearTimeout(timeout);
          channel.port1.close();
          if (event.data?.ok === true) resolve();
          else reject(new Error("Не удалось очистить сохранённые страницы."));
        };
        controller.postMessage({ type: "PULSE_CLEAR_PAGES" }, [channel.port2]);
      });
    }
  } finally {
    if ("caches" in window) {
      await new PwaPageCache(window.caches, window.location.origin).clear();
    }
  }
}

export function watchPwaInstallation(registration: ServiceWorkerRegistration) {
  const cleanups: (() => void)[] = [];
  function watch() {
    const worker = registration.installing;
    if (!worker) {
      if (!registration.active && !registration.waiting)
        console.warn("PWA_SW_INSTALL_FAILED");
      return;
    }
    function changed() {
      if (worker?.state === "redundant") console.warn("PWA_SW_INSTALL_FAILED");
      if (worker?.state === "redundant" || worker?.state === "activated")
        worker.removeEventListener("statechange", changed);
    }
    worker.addEventListener("statechange", changed);
    cleanups.push(() => worker.removeEventListener("statechange", changed));
    changed();
  }
  registration.addEventListener("updatefound", watch);
  watch();
  return () => {
    registration.removeEventListener("updatefound", watch);
    for (const cleanup of cleanups) cleanup();
  };
}

export interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let installPrompt: InstallPrompt | null = null;
export function rememberInstallPrompt(value: InstallPrompt | null) {
  installPrompt = value;
}
export function getInstallPrompt() {
  return installPrompt;
}
