"use client";

import { useActionState, useEffect, useState } from "react";
import { scheduleMessages } from "@/ui/i18n/dictionaries/schedule";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { absoluteAppUrl, appPath } from "@/ui/shared/app-path.mjs";

export type CalendarErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export type CalendarActionState =
  | { ok: true; path: string }
  | { ok: false; status: number; error: { code: CalendarErrorCode } }
  | null;

export function CalendarSubscription({
  action,
}: {
  action: (
    previous: CalendarActionState,
    formData: FormData,
  ) => Promise<CalendarActionState>;
}) {
  const language = useLanguage();
  const [state, submit, pending] = useActionState(action, null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return (
    <Card className="min-w-0 [overflow-wrap:normal] [word-break:normal]">
      <CardHeader>
        <CardTitle>
          <h2>{t(language, scheduleMessages, "calendarTitle")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t(language, scheduleMessages, "calendarDescription")}
        </p>
        <form action={submit}>
          <Button
            type="submit"
            variant="outline"
            className="h-auto max-w-full whitespace-normal"
            disabled={pending || !origin}
            data-calendar-ready={origin ? "true" : "false"}
          >
            {pending
              ? t(language, scheduleMessages, "calendarCreating")
              : state?.ok
                ? t(language, scheduleMessages, "calendarRenew")
                : t(language, scheduleMessages, "calendarCreate")}
          </Button>
        </form>
        <p className="text-sm text-muted-foreground">
          {t(language, scheduleMessages, "calendarRevokeNotice")}
        </p>
        <div aria-live="polite">
          {state?.ok && (
            <div className="space-y-2">
              <label
                htmlFor="calendar-url"
                className="block text-sm font-medium"
              >
                {t(language, scheduleMessages, "calendarUrl")}
              </label>
              <input
                id="calendar-url"
                readOnly
                value={origin ? absoluteAppUrl(origin, state.path) : ""}
                onFocus={(event) => event.currentTarget.select()}
                className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm"
              />
              <Button asChild variant="link">
                <a href={appPath(state.path)} download="pulse.ics">
                  {t(language, scheduleMessages, "calendarDownload")}
                </a>
              </Button>
            </div>
          )}
          {state && !state.ok && (
            <p role="alert" className="text-sm text-foreground">
              {t(language, scheduleMessages, state.error.code)}{" "}
              {t(language, scheduleMessages, "calendarRetry")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
