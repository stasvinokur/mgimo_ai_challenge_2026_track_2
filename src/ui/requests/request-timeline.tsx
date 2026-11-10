import type { RequestStatus, RequestTypeDto } from "@/application/requests/dto";
import { getRequestExplanationMessage } from "@/application/requests/messages";
import type { RequestDetailDto } from "@/application/requests/queries";
import { certificatesMessages } from "@/ui/i18n/dictionaries/certificates";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { appPath } from "@/ui/shared/app-path.mjs";
import { formatRequestDate } from "./format";

export function getRequestExplanation(
  status: RequestStatus,
  type: Pick<RequestTypeDto, "code" | "isCertificate">,
  language: Language = "ru",
): string {
  return t(
    language,
    requestsMessages,
    getRequestExplanationMessage(status, type).code,
  );
}

const mainStages: RequestStatus[] = [
  "submitted",
  "accepted",
  "in_progress",
  "ready",
  "issued",
];
export function RequestTimeline({
  request,
  canDownload = false,
  language = "ru",
}: {
  request: RequestDetailDto;
  canDownload?: boolean;
  language?: Language;
}) {
  const tr = (
    key: keyof typeof requestsMessages,
    params?: Record<string, string | number>,
  ) => t(language, requestsMessages, key, params);
  const visited = new Set(request.events.map((event) => event.toStatus));
  const pending = mainStages.filter((status) => !visited.has(status));
  const terminal = ["rejected", "cancelled", "issued"].includes(request.status);
  return (
    <Card className="rounded-feature gap-3 py-4">
      <CardHeader className="px-4 sm:px-6">
        <CardTitle>
          <h2>{tr("progress")}</h2>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{tr("stageTimes")}</p>
        {request.dueAt && (
          <p className="text-sm text-muted-foreground">
            {tr("slaDeadline", {
              date: formatRequestDate(request.dueAt, true, language),
            })}
          </p>
        )}
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        {canDownload &&
          request.type.isCertificate &&
          (request.status === "ready" || request.status === "issued") && (
            <Button asChild className="mb-5">
              <a href={appPath(`/api/requests/${request.id}/pdf`)} download>
                {t(language, certificatesMessages, "downloadCertificate")}
              </a>
            </Button>
          )}
        <ol className="min-w-0">
          {request.events.map((event, index) => {
            const current = index === request.events.length - 1;
            return (
              <li
                key={event.id}
                aria-current={current ? "step" : undefined}
                className="relative grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-3"
              >
                <div
                  aria-hidden="true"
                  className="relative flex justify-center"
                >
                  {(!current || (!terminal && pending.length > 0)) && (
                    <span
                      className={`absolute inset-y-0 w-0.5 ${current ? "bg-border" : "bg-primary"}`}
                    />
                  )}
                  <span
                    className={`relative mt-1.5 size-3.5 rounded-full bg-primary ${current ? "ring-4 ring-accent" : ""}`}
                  />
                </div>
                <div
                  className={`min-w-0 pb-5 ${current ? "text-accent-foreground" : ""}`}
                >
                  <p
                    className={`font-semibold ${current ? "font-extrabold" : ""}`}
                  >
                    {tr(event.toStatus)}
                    {current ? tr("currentStage") : ""}
                  </p>
                  <time
                    className="text-sm text-muted-foreground"
                    dateTime={event.at}
                  >
                    {formatRequestDate(event.at, true, language)}
                  </time>
                  {current &&
                    (event.toStatus === "ready" ||
                      event.toStatus === "issued") && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {getRequestExplanation(
                          event.toStatus,
                          request.type,
                          language,
                        )}
                      </p>
                    )}
                  {event.comment && (
                    <p className="mt-2 whitespace-pre-wrap rounded-xl bg-secondary p-3 text-sm text-foreground">
                      {event.comment}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
          {!terminal &&
            pending.map((status, index) => (
              <li
                key={status}
                className="relative grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-3 text-sm text-muted-foreground"
              >
                <div
                  aria-hidden="true"
                  className="relative flex justify-center"
                >
                  {index < pending.length - 1 && (
                    <span className="absolute inset-y-0 w-0.5 bg-border" />
                  )}
                  <span className="relative mt-1.5 size-3.5 rounded-full border-2 border-muted-foreground bg-card" />
                </div>
                <p className="pb-5">{tr("awaited", { status: tr(status) })}</p>
              </li>
            ))}
        </ol>
        {!request.events.length && (
          <p className="text-sm text-muted-foreground">{tr("historyLater")}</p>
        )}
      </CardContent>
    </Card>
  );
}
