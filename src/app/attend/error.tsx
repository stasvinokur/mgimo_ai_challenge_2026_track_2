"use client";

import { RotateCcw, Unplug } from "lucide-react";
import { attendanceMessages } from "@/ui/i18n/dictionaries/attendance";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/primitives/empty-state";

export default function AttendanceError({ reset }: { reset: () => void }) {
  const language = useLanguage();
  return (
    <div role="alert">
      <EmptyState
        icon={Unplug}
        title={t(language, attendanceMessages, "errorTitle")}
        description={t(language, attendanceMessages, "errorHint")}
        action={
          <Button onClick={reset}>
            <RotateCcw aria-hidden="true" />
            {t(language, attendanceMessages, "retry")}
          </Button>
        }
      />
    </div>
  );
}
