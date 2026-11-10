"use client";

import Link from "next/link";
import { shellMessages } from "@/ui/i18n/dictionaries/shell";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { appPath } from "@/ui/shared/app-path.mjs";

export function Brand({ href = "/today" }: { href?: string }) {
  const language = useLanguage();
  return (
    // Accessible name must contain the visible text (WCAG 2.5.3, axe label-content-name-mismatch).
    <Link
      href={href}
      className="brand [overflow-wrap:normal] [word-break:normal]"
    >
      {/* The SVG source also supplies the app icons. */}
      {/* biome-ignore lint/performance/noImgElement: local SVG logo does not need image optimization */}
      <img src={appPath("/pulse.svg")} width="40" height="40" alt="" />
      <span>
        {t(language, shellMessages, "brandName")}{" "}
        <span className="brand-caption">
          {t(language, shellMessages, "brandCaption")}
        </span>
        <span className="sr-only">
          {t(language, shellMessages, "homeSuffix")}
        </span>
      </span>
    </Link>
  );
}
