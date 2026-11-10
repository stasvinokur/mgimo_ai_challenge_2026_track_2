import { appPath } from "@/ui/shared/app-path.mjs";
import { isPulseWorker, ownPwaRegistration } from "@/ui/shell/pwa-scope";
export async function clearPushBeforeLogout(timeoutMs = 2000): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    typeof navigator.serviceWorker.getRegistration !== "function"
  )
    return;

  const controller = new AbortController();
  let expired = false;
  let subscription: PushSubscription | null = null;
  let removal: Promise<void> | undefined;
  function unsubscribe() {
    if (!subscription || removal) return removal;
    try {
      removal = subscription.unsubscribe().then(
        () => undefined,
        () => console.warn("PUSH_LOGOUT_UNSUBSCRIBE_FAILED"),
      );
    } catch {
      console.warn("PUSH_LOGOUT_UNSUBSCRIBE_FAILED");
      removal = Promise.resolve();
    }
    return removal;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      controller.abort();
      console.warn("PUSH_LOGOUT_TIMEOUT");
      void unsubscribe();
      resolve();
    }, timeoutMs);
  });
  const cleanup = async () => {
    const registration = await ownPwaRegistration();
    if (
      expired ||
      !registration?.pushManager ||
      !isPulseWorker(registration.active, window.location.origin)
    )
      return;
    subscription = await registration.pushManager.getSubscription();
    if (expired) {
      await unsubscribe();
      return;
    }
    if (!subscription) return;
    try {
      const response = await fetch(appPath("/api/push/subscription"), {
        method: "DELETE",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        signal: controller.signal,
      });
      if (expired) {
        await response.body?.cancel();
        return;
      }
      await response.arrayBuffer();
      if (!response.ok && response.status !== 404)
        console.warn("PUSH_LOGOUT_DELETE_FAILED");
    } catch {
      if (!expired) console.warn("PUSH_LOGOUT_DELETE_FAILED");
    } finally {
      await unsubscribe();
    }
  };
  try {
    await Promise.race([
      cleanup().catch(() => console.warn("PUSH_LOGOUT_CLEANUP_FAILED")),
      deadline,
    ]);
  } finally {
    expired = true;
    clearTimeout(timer);
    controller.abort();
  }
}
