"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { regulationsMessages } from "@/ui/i18n/dictionaries/regulations";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { absoluteAppUrl, appPath } from "@/ui/shared/app-path.mjs";

export function RegulationHashFocus() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    let highlighted: HTMLElement | null = null;
    const focus = () => {
      const url = new URL(window.location.href);
      if (
        url.pathname !== appPath(pathname) ||
        url.searchParams.toString() !== searchParams.toString()
      )
        return;
      highlighted?.removeAttribute("data-highlighted");
      highlighted = null;
      const id = url.hash.slice(1);
      if (!/^p-\d+(?:-\d+)*$/.test(id)) return;
      const section = document.getElementById(id);
      if (section) {
        highlighted = section;
        section.setAttribute("data-highlighted", "true");
        section.focus({ preventScroll: true });
        section.scrollIntoView({ block: "start" });
      }
    };
    focus();
    window.addEventListener("hashchange", focus);
    window.addEventListener("popstate", focus);
    return () => {
      highlighted?.removeAttribute("data-highlighted");
      window.removeEventListener("hashchange", focus);
      window.removeEventListener("popstate", focus);
    };
  }, [pathname, searchParams]);
  return null;
}

export function CopySectionLink({
  href,
  section,
}: {
  href: string;
  section: string;
}) {
  const language = useLanguage();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [fallback, setFallback] = useState("");
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        className="h-auto max-w-full whitespace-normal py-2 text-left"
        data-copy-ready={ready}
        disabled={!ready}
        onClick={async () => {
          const url = absoluteAppUrl(window.location.origin, href);
          try {
            await navigator.clipboard.writeText(url);
            setFallback("");
            toast.success(t(language, regulationsMessages, "copied"));
          } catch {
            setFallback(url);
          }
        }}
      >
        {t(language, regulationsMessages, "copy", { section })}
      </Button>
      {fallback && (
        <label className="block text-sm">
          {t(language, regulationsMessages, "copyManually")}
          <input
            className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3"
            readOnly
            value={fallback}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
    </div>
  );
}
