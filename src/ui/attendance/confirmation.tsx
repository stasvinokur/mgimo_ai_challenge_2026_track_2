"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { markAttendance } from "@/app/attend/actions";
import type { Confirmation } from "@/application/attendance/student";
import { attendanceMessages } from "@/ui/i18n/dictionaries/attendance";
import { formatNumber } from "@/ui/i18n/format";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent } from "@/ui/primitives/card";
import { appPath } from "@/ui/shared/app-path.mjs";

export function AttendanceConfirmation({
  code,
  confirmation,
}: {
  code: string;
  confirmation: Confirmation;
}) {
  const language = useLanguage();
  const text = (key: keyof typeof attendanceMessages, params = {}) =>
    t(language, attendanceMessages, key, params);
  const [ready, setReady] = useState(false);
  const [state, action, pending] = useActionState(
    markAttendance.bind(null, code),
    null,
  );
  const complete =
    state?.result === "marked" ||
    state?.result === "already" ||
    state?.result === "invalid";
  useEffect(() => {
    setReady(true);
    if (complete || !confirmation.valid || confirmation.alreadyPresent) {
      window.history.replaceState(window.history.state, "", appPath("/attend"));
    }
  }, [complete, confirmation]);
  return (
    <div className="section-page">
      <p className="eyebrow">{text("attendance")}</p>
      <h1>{text("pageTitle")}</h1>
      <Card>
        <CardContent className="space-y-4">
          {state ? (
            <p role="status">
              {text(
                state.messageCode,
                state.result === "marked"
                  ? { points: formatNumber(language, state.points) }
                  : {},
              )}
            </p>
          ) : !confirmation.valid ? (
            <p>{text(confirmation.messageCode)}</p>
          ) : confirmation.alreadyPresent ? (
            <p>{text("alreadyPresent")}</p>
          ) : (
            <>
              <h2 className="text-xl font-semibold">
                {text("confirmTitle", { course: confirmation.course })}
              </h2>
              <p className="text-muted-foreground">{text("confirmHint")}</p>
            </>
          )}
          {confirmation.valid && !confirmation.alreadyPresent && !complete && (
            <form action={action} aria-busy={pending}>
              <Button
                type="submit"
                disabled={pending || !ready}
                data-attendance-ready={ready}
                className="min-h-11 whitespace-nowrap [overflow-wrap:normal]"
              >
                {text(pending ? "pending" : "checkIn")}
              </Button>
            </form>
          )}
          <Link
            href="/grades#attendance"
            className="inline-flex min-h-11 items-center text-primary underline [overflow-wrap:normal]"
          >
            {text("myPoints")}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
