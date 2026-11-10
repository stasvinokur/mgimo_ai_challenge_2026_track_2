"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState, useTransition } from "react";
import { searchMessages } from "@/ui/i18n/dictionaries/search";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Skeleton } from "@/ui/primitives/skeleton";
import { appPath } from "@/ui/shared/app-path.mjs";

export function SearchForm({
  children,
  className,
  compact = false,
}: {
  children?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <div className={compact ? "relative min-w-0" : "space-y-4"}>
      <form
        action={appPath("/search")}
        method="get"
        className={className}
        aria-busy={pending || undefined}
        data-search-ready={ready ? "true" : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          const q = new FormData(event.currentTarget).get("q");
          const query = typeof q === "string" ? q : "";
          start(() =>
            router.push(`/search?${new URLSearchParams({ q: query })}`),
          );
        }}
      >
        {children}
      </form>
      {pending && <SearchPending compact={compact} />}
    </div>
  );
}

export function SearchPending({ compact = false }: { compact?: boolean }) {
  const language = useLanguage();
  return (
    <section
      aria-label={t(language, searchMessages, "loading")}
      className={
        compact
          ? "absolute inset-x-0 top-full z-40 mt-2 space-y-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm"
          : "space-y-4 rounded-xl border border-border bg-card p-4 text-card-foreground"
      }
    >
      <p role="status" className="text-sm text-muted-foreground">
        {t(language, searchMessages, "searching")}
      </p>
      <div aria-hidden="true" className="space-y-3">
        <Skeleton className={compact ? "h-3 w-full" : "h-12 w-full"} />
        <Skeleton className={compact ? "h-3 w-3/4" : "h-32 w-full"} />
      </div>
    </section>
  );
}
