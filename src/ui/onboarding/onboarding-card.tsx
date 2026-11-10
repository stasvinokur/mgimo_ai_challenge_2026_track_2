"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { OnboardingDto } from "@/application/onboarding/get-onboarding";
import { onboardingMessages } from "@/ui/i18n/dictionaries/onboarding";
import { formatNumber } from "@/ui/i18n/format";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader } from "@/ui/primitives/card";
import { appPath } from "@/ui/shared/app-path.mjs";
import { openAssistant } from "@/ui/shell/assistant-entry";

const links = {
  schedule: "/schedule?view=week",
  calendar: "/schedule",
  install: "/today/install",
  regulations: "/regulations?q=стипендия",
  assistant: "/profile/assistant",
  push: "/profile#push-notifications",
  passkey: "/profile#passkeys",
};

type Mutation = { stepCode: string } | { action: "hide" };

export function OnboardingCard({ initial }: { initial: OnboardingDto }) {
  const language = useLanguage();
  const heading = useId();
  const router = useRouter();
  const [data, setData] = useState<OnboardingDto | null>(initial);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState<Mutation | null>(null);
  const [watchAssistant, setWatchAssistant] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    busy.current = false;
    setPending(false);
    setRetry(null);
    setWatchAssistant(false);
    setData(initial);
  }, [initial]);
  useEffect(() => setReady(true), []);
  const assistantPending = data?.steps.some(
    (step) => step.code === "assistant" && !step.completed,
  );
  useEffect(() => {
    if (!watchAssistant || !assistantPending) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      try {
        if (!busy.current && document.visibilityState === "visible") {
          const current = generation.current;
          const response = await fetch(appPath("/api/me/onboarding"), {
            cache: "no-store",
            signal: controller.signal,
          });
          const next: OnboardingDto | null = await response.json();
          if (!response.ok) throw new Error("ONBOARDING_REFRESH_FAILED");
          if (active && !busy.current && current === generation.current)
            setData(next);
        }
      } catch {
        if (active) console.warn("ONBOARDING_REFRESH_FAILED");
      } finally {
        if (active) timer = setTimeout(() => void refresh(), 1500);
      }
    }
    void refresh();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [watchAssistant, assistantPending]);

  async function mutate(input: Mutation) {
    if (busy.current) return;
    const current = ++generation.current;
    busy.current = true;
    setPending(true);
    setRetry(null);
    try {
      const response = await fetch(appPath("/api/me/onboarding"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const result: OnboardingDto | null = await response.json();
      if (!response.ok) throw new Error("ONBOARDING_SAVE_FAILED");
      if (current !== generation.current) return;
      setData(result);
      router.refresh();
    } catch {
      if (current === generation.current) setRetry(input);
    } finally {
      if (current === generation.current) {
        busy.current = false;
        setPending(false);
      }
    }
  }

  if (!data) return null;
  return (
    <section
      aria-labelledby={heading}
      data-testid="onboarding-card"
      data-onboarding-ready={ready}
      aria-busy={pending}
      className="min-w-0 [overflow-wrap:normal] [word-break:normal]"
    >
      <Card className="min-w-0 gap-3 rounded-feature py-4">
        <CardHeader className="px-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={heading} className="text-lg font-bold">
              {t(language, onboardingMessages, "title")}
            </h2>
            <Button
              variant="ghost"
              disabled={pending || !ready}
              onClick={() => void mutate({ action: "hide" })}
            >
              {t(language, onboardingMessages, "hide")}
              <span className="sr-only">
                {t(language, onboardingMessages, "hideDetail")}
              </span>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {t(language, onboardingMessages, "introduction")}
          </p>
          <p className="text-sm font-medium" aria-live="polite">
            {t(language, onboardingMessages, "progress", {
              completed: formatNumber(language, data.completed),
              total: formatNumber(language, data.total),
            })}
          </p>
        </CardHeader>
        <CardContent className="space-y-3 px-4">
          <ol className="grid min-w-0 gap-x-6 divide-y divide-border lg:grid-cols-2">
            {data.steps.map((step) => {
              const title = t(language, onboardingMessages, step.code);
              return (
                <li
                  key={step.code}
                  data-onboarding-step={step.code}
                  className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2"
                >
                  <div className="min-w-0 flex-1 basis-44">
                    <Link
                      href={links[step.code]}
                      className="flex min-h-11 items-center gap-2 rounded-md py-2 text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={
                        step.code === "assistant"
                          ? (event) => {
                              event.preventDefault();
                              setWatchAssistant(true);
                              openAssistant();
                            }
                          : undefined
                      }
                    >
                      {title}
                    </Link>
                    {step.automatic && !step.completed && (
                      <p className="text-xs text-muted-foreground">
                        {t(language, onboardingMessages, "automatic")}
                      </p>
                    )}
                  </div>
                  {step.completed ? (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Check className="size-4" aria-hidden="true" />
                      {t(language, onboardingMessages, "completed")}
                    </span>
                  ) : (
                    !step.automatic && (
                      <Button
                        variant="outline"
                        disabled={pending || !ready}
                        onClick={() => void mutate({ stepCode: step.code })}
                      >
                        {t(language, onboardingMessages, "done")}
                        <span className="sr-only">: {title}</span>
                      </Button>
                    )
                  )}
                </li>
              );
            })}
          </ol>
          {data.completed === data.total && (
            <p className="text-sm">
              {t(language, onboardingMessages, "allDone")}
            </p>
          )}
          {pending && (
            <p className="text-sm">
              {t(language, onboardingMessages, "saving")}
            </p>
          )}
          {retry && (
            <div role="alert" className="space-y-2 text-sm">
              <p>{t(language, onboardingMessages, "saveError")}</p>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void mutate(retry)}
              >
                {t(language, onboardingMessages, "retry")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
