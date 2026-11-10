"use client";

import { Download, Link as LinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { CertificateCardDto } from "@/application/certificates/get-certificate-card";
import { certificatesMessages } from "@/ui/i18n/dictionaries/certificates";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent } from "@/ui/primitives/card";
import { appPath } from "@/ui/shared/app-path.mjs";
import { formatRequestDate } from "./format";
import { requestTypeTitle } from "./translations";

export function CertificateCard({
  id,
  certificate,
  typeCode,
}: {
  id: string;
  certificate: CertificateCardDto;
  typeCode?: string;
}) {
  const language = useLanguage();
  const tr = (
    key: keyof typeof certificatesMessages,
    params?: Record<string, string | number>,
  ) => t(language, certificatesMessages, key, params);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [copy, setCopy] = useState<"idle" | "copied" | "fallback">("idle");
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(certificate.verificationUrl);
      setCopy("copied");
    } catch {
      setCopy("fallback");
    }
  }
  return (
    <Card
      variant="hero"
      role="region"
      aria-label={tr("ready")}
      data-ready={ready ? "true" : undefined}
      className="min-w-0 gap-4 py-5"
    >
      <CardContent className="space-y-4 px-4 sm:px-6">
        <div className="flex items-center gap-4">
          {/* biome-ignore lint/performance/noImgElement: D-30 requires the owner-only PNG data URL without an image optimizer. */}
          <img
            src={certificate.qrDataUrl}
            alt={tr("qr", { number: certificate.number })}
            width={128}
            height={128}
            className="size-28 shrink-0 rounded-xl [image-rendering:pixelated] sm:size-32"
          />
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-extrabold sm:text-xl">
              {certificate.number}
            </h2>
            <p className="text-sm text-pulse-muted">
              {tr("issuedOn", {
                type: requestTypeTitle(language, {
                  code: typeCode ?? "",
                  title: certificate.type,
                }),
                date: formatRequestDate(certificate.issuedAt, false, language),
              })}
            </p>
            <p className="text-sm font-semibold text-pulse-now">
              {certificate.revoked ? tr("revoked") : tr("verification")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            asChild
            className="h-auto min-h-12 flex-1 whitespace-nowrap [overflow-wrap:normal] rounded-xl bg-pulse-foreground text-pulse hover:bg-pulse-muted"
          >
            <a href={appPath(`/api/requests/${id}/pdf`)} download>
              <Download aria-hidden="true" />
              {tr("download")}
            </a>
          </Button>
          <Button
            variant="ghost"
            className="min-h-12 rounded-xl border border-pulse-line text-pulse-foreground hover:bg-pulse-foreground hover:text-pulse dark:hover:bg-pulse-foreground dark:hover:text-pulse"
            onClick={() => void copyLink()}
          >
            <LinkIcon aria-hidden="true" />
            {tr("link")}
          </Button>
        </div>
        <div role="status" className="text-sm text-pulse-muted">
          {copy === "copied" && tr("copied")}
          {copy === "fallback" && (
            <>
              <p>{tr("copyFailed")}</p>
              <p className="mt-2 select-text break-all">
                {certificate.verificationUrl}
              </p>
            </>
          )}
        </div>
        {language === "en" && (
          <p className="text-sm text-pulse-muted">{tr("russianDocument")}</p>
        )}
        <p className="text-xs text-pulse-muted">{tr("concept")}</p>
      </CardContent>
    </Card>
  );
}
