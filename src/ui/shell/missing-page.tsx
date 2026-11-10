"use client";

import { MapPinOff, Shield } from "lucide-react";
import Link from "next/link";
import { shellMessages } from "@/ui/i18n/dictionaries/shell";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/primitives/empty-state";

export function MissingPage({ forbidden = false }: { forbidden?: boolean }) {
  const language = useLanguage();
  return (
    <div className="standalone-state [overflow-wrap:normal] [word-break:normal]">
      <p className="eyebrow">
        {t(language, shellMessages, "brandName")} · {forbidden ? "403" : "404"}
      </p>
      <h1>
        {t(language, shellMessages, forbidden ? "forbidden" : "notFound")}
      </h1>
      <EmptyState
        icon={forbidden ? Shield : MapPinOff}
        title={t(
          language,
          shellMessages,
          forbidden ? "forbiddenTitle" : "notFoundTitle",
        )}
        description={t(
          language,
          shellMessages,
          forbidden ? "forbiddenDescription" : "notFoundDescription",
        )}
        action={
          <Button asChild>
            <Link href="/today">{t(language, shellMessages, "goToday")}</Link>
          </Button>
        }
      />
    </div>
  );
}
