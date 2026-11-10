"use client";

import { todayMessages } from "@/ui/i18n/dictionaries/today";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Card, CardContent } from "@/ui/primitives/card";
import { Skeleton } from "@/ui/primitives/skeleton";

export default function Loading() {
  const language = useLanguage();
  return (
    <section
      aria-label={t(language, todayMessages, "loadingPage")}
      aria-busy="true"
      className="section-page"
    >
      <span role="status" className="sr-only">
        {t(language, todayMessages, "loading")}
      </span>
      <div aria-hidden="true" className="space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-10 w-4/5" />
      </div>
      <Card aria-hidden="true" className="rounded-feature py-4">
        <CardContent className="space-y-3 px-4">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-28 w-full" />
        </CardContent>
      </Card>
      <div
        aria-hidden="true"
        className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-5"
      >
        <div className="min-w-0 space-y-4">
          <Card variant="hero" className="py-5">
            <CardContent className="space-y-4 px-5">
              <Skeleton className="h-4 w-1/3 bg-pulse-line/30" />
              <Skeleton className="h-14 w-4/5 bg-pulse-line/30" />
              <Skeleton className="h-6 w-full bg-pulse-line/30" />
              <Skeleton className="h-4 w-3/4 bg-pulse-line/30" />
              <Skeleton className="h-24 w-full bg-pulse-line/30" />
            </CardContent>
          </Card>
          <Skeleton className="h-24 w-full rounded-feature bg-[var(--warning-bg)]" />
          <Card className="hidden rounded-feature lg:flex">
            <CardContent className="space-y-4 px-4">
              <Skeleton className="h-6 w-2/3" />
              <div className="grid grid-cols-6 gap-2">
                {["mon", "tue", "wed", "thu", "fri", "sat"].map((day) => (
                  <Skeleton key={day} className="h-40 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="min-w-0 space-y-4">
          <Card className="rounded-feature">
            <CardContent className="space-y-4 px-4">
              <Skeleton className="h-6 w-2/3" />
              {[0, 1].map((item) => (
                <div key={item} className="flex items-center gap-3">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                  </div>
                  <Skeleton className="h-11 w-24" />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="rounded-feature">
            <CardContent className="flex items-center gap-3 px-4">
              <Skeleton className="size-22 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </CardContent>
          </Card>
          {[0, 1].map((item) => (
            <Card key={item} className="hidden rounded-feature lg:flex">
              <CardContent className="space-y-4 px-4">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-11 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
