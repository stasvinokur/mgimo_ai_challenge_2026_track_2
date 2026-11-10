"use client";

import { shellMessages } from "@/ui/i18n/dictionaries/shell";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Skeleton } from "@/ui/primitives/skeleton";

export function PageLoading() {
  const language = useLanguage();
  return (
    <section
      className="section-page"
      aria-busy="true"
      aria-label={t(language, shellMessages, "loadingPage")}
    >
      <p role="status" className="sr-only">
        {t(language, shellMessages, "loadingPulse")}
      </p>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-64 w-full rounded-2xl" />
      <div className="shortcut-grid">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    </section>
  );
}
