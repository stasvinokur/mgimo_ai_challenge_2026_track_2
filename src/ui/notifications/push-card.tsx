"use client";

import { useEffect, useState } from "react";
import { profileMessages } from "@/ui/i18n/dictionaries/profile";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { useProfileAnchor } from "@/ui/onboarding/profile-anchor";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { Skeleton } from "@/ui/primitives/skeleton";
import { appPath } from "@/ui/shared/app-path.mjs";
import { readyPwaRegistration } from "@/ui/shell/pwa-scope";

type MessageCode = keyof typeof profileMessages;

type PushState =
  | { kind: "loading" }
  | { kind: "unavailable"; message: MessageCode }
  | { kind: "error"; message: MessageCode }
  | {
      kind: "ready";
      publicKey: string;
      registration: ServiceWorkerRegistration;
      subscription: PushSubscription | null;
      subscribed: boolean;
    };

class PushRequestError extends Error {
  constructor(
    readonly messageCode: MessageCode,
    readonly status?: number,
  ) {
    super(messageCode);
  }
}

async function pushRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(appPath(path), { cache: "no-store", ...init });
  const body = await response.text();
  if (!response.ok) {
    if (response.status === 429)
      throw new PushRequestError("pushRateLimited", response.status);
    if (response.status === 401)
      throw new PushRequestError("pushSessionEnded", response.status);
    throw new PushRequestError("pushSaveFailed", response.status);
  }
  return JSON.parse(body);
}

function mutation(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function applicationServerKey(value: string) {
  const bytes = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

function needsHomeScreen() {
  const appleMobile =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return appleMobile && !standalone;
}

async function readyWorker() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const registration = await Promise.race([
      readyPwaRegistration(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PushRequestError("pushWorkerNotReady")),
          8000,
        );
      }),
    ]);
    if (!registration) throw new PushRequestError("pushWorkerNotReady");
    return registration;
  } finally {
    clearTimeout(timer);
  }
}

export function PushCard() {
  const language = useLanguage();
  const [state, setState] = useState<PushState>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<MessageCode | "">("");
  const [error, setError] = useState<MessageCode | "">("");
  useProfileAnchor("push-notifications");

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload explicitly requests fresh subscription state.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setState({ kind: "loading" });
    async function load() {
      if (needsHomeScreen()) {
        setState({
          kind: "unavailable",
          message: "pushHomeScreen",
        });
        return;
      }
      if (
        !("serviceWorker" in navigator) ||
        typeof PushManager === "undefined" ||
        typeof Notification === "undefined" ||
        !window.isSecureContext
      ) {
        setState({
          kind: "unavailable",
          message: "pushUnsupported",
        });
        return;
      }
      try {
        const data = await pushRequest("/api/push", {
          signal: controller.signal,
        });
        if (!active) return;
        if (
          !data ||
          typeof data !== "object" ||
          !("publicKey" in data) ||
          !("endpoints" in data) ||
          !(data.publicKey === null || typeof data.publicKey === "string") ||
          !Array.isArray(data.endpoints) ||
          !data.endpoints.every((endpoint) => typeof endpoint === "string")
        )
          throw new Error("PUSH_CONFIGURATION_INVALID");
        if (!data.publicKey) {
          setState({
            kind: "unavailable",
            message: "pushNotConfigured",
          });
          return;
        }
        if (Notification.permission === "denied") {
          setState({
            kind: "unavailable",
            message: "pushDenied",
          });
          return;
        }
        const registration = await readyWorker();
        const subscription = await registration.pushManager.getSubscription();
        if (active)
          setState({
            kind: "ready",
            publicKey: data.publicKey,
            registration,
            subscription,
            subscribed:
              subscription !== null &&
              data.endpoints.includes(subscription.endpoint),
          });
      } catch (cause) {
        if (active)
          setState({
            kind: "error",
            message:
              cause instanceof PushRequestError
                ? cause.messageCode
                : "pushLoadFailed",
          });
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [reload]);

  async function enable() {
    if (state.kind !== "ready" || busy) return;
    setBusy(true);
    setNotice("");
    setError("");
    let created: PushSubscription | null = null;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("pushPermissionRequired");
        return;
      }
      let subscription = state.subscription;
      if (subscription && !state.subscribed) {
        await subscription.unsubscribe();
        subscription = null;
        setState({ ...state, subscription: null, subscribed: false });
      }
      if (!subscription) {
        subscription = await state.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(state.publicKey),
        });
        created = subscription;
      }
      await pushRequest(
        "/api/push/subscription",
        mutation("POST", subscription.toJSON()),
      );
      setState({ ...state, subscription, subscribed: true });
      setNotice("pushEnabled");
    } catch (cause) {
      if (created)
        await created.unsubscribe().catch(() => {
          console.warn("PUSH_SUBSCRIPTION_CLEANUP_FAILED");
        });
      setError(
        cause instanceof PushRequestError
          ? cause.messageCode
          : "pushEnableFailed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function act(action: "disable" | "test") {
    if (state.kind !== "ready" || !state.subscription || busy) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      try {
        await pushRequest(
          action === "disable" ? "/api/push/subscription" : "/api/push/test",
          mutation(action === "disable" ? "DELETE" : "POST", {
            endpoint: state.subscription.endpoint,
          }),
        );
      } catch (cause) {
        if (
          action !== "disable" ||
          !(cause instanceof PushRequestError) ||
          cause.status !== 404
        )
          throw cause;
      }
      if (action === "disable") {
        const removed = await state.subscription.unsubscribe().catch(() => {
          console.warn("PUSH_UNSUBSCRIBE_FAILED");
          return false;
        });
        setState({
          ...state,
          subscription: removed ? null : state.subscription,
          subscribed: false,
        });
        setNotice("pushDisabled");
      } else {
        setNotice("pushTestSent");
      }
    } catch (cause) {
      if (
        action === "test" &&
        cause instanceof PushRequestError &&
        (cause.status === 400 || cause.status === 404)
      ) {
        setError("pushTestFailed");
        setReload((value) => value + 1);
        return;
      }
      setError(
        cause instanceof PushRequestError
          ? cause.messageCode
          : "pushActionFailed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      id="push-notifications"
      className="scroll-mt-24"
      data-push-state={state.kind}
      data-profile-anchor-ready={state.kind !== "loading"}
    >
      <CardHeader>
        <CardTitle>
          <h2>{t(language, profileMessages, "pushTitle")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t(language, profileMessages, "pushDescription")}
        </p>
        {state.kind === "loading" && (
          <div role="status" className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-11 w-28" />
            <span className="sr-only">
              {t(language, profileMessages, "pushLoading")}
            </span>
          </div>
        )}
        {state.kind === "unavailable" && (
          <p>{t(language, profileMessages, state.message)}</p>
        )}
        {state.kind === "error" && (
          <div className="space-y-3">
            <p role="alert">{t(language, profileMessages, state.message)}</p>
            <Button
              variant="outline"
              onClick={() => {
                setNotice("");
                setError("");
                setReload((value) => value + 1);
              }}
            >
              {t(language, profileMessages, "retry")}
            </Button>
          </div>
        )}
        {state.kind === "ready" && (
          <>
            <p>
              {t(
                language,
                profileMessages,
                state.subscribed ? "pushOn" : "pushOff",
              )}
            </p>
            <div className="flex flex-wrap gap-2" aria-busy={busy}>
              {state.subscribed ? (
                <>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void act("disable")}
                  >
                    {t(language, profileMessages, "disable")}
                  </Button>
                  <Button disabled={busy} onClick={() => void act("test")}>
                    {t(language, profileMessages, "test")}
                  </Button>
                </>
              ) : (
                <Button disabled={busy} onClick={() => void enable()}>
                  {t(language, profileMessages, "enable")}
                </Button>
              )}
            </div>
          </>
        )}
        {notice && <p role="status">{t(language, profileMessages, notice)}</p>}
        {error && <p role="alert">{t(language, profileMessages, error)}</p>}
      </CardContent>
    </Card>
  );
}
