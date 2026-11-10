"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { todayMessages } from "@/ui/i18n/dictionaries/today";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";

export function SourceError({ name }: { name: string }) {
  const language = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-border bg-muted p-4"
    >
      <p className="font-medium">
        {t(language, todayMessages, "sourceError", { name })}
      </p>
      <p className="text-sm text-muted-foreground">
        {t(language, todayMessages, "sourceRetryHint")}
      </p>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => start(() => router.refresh())}
      >
        {t(language, todayMessages, pending ? "refreshing" : "retry")}
        <span className="sr-only">: {name}</span>
      </Button>
    </div>
  );
}
