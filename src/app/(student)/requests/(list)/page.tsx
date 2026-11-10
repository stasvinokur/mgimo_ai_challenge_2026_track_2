import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { requests } from "@/composition/container";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent } from "@/ui/primitives/card";
import { EmptyState } from "@/ui/primitives/empty-state";
import { formatRequestDate } from "@/ui/requests/format";
import { RequestStageBar } from "@/ui/requests/request-stage-bar";
import {
  RequestSlaBadge,
  RequestStatusBadge,
} from "@/ui/requests/request-status";
import { requestTypeTitle } from "@/ui/requests/translations";

export async function generateMetadata() {
  await requireStudent();
  return { title: t(await getLanguage(), requestsMessages, "requests") };
}

export default async function Page() {
  const actor = await requireStudent();
  const language = await getLanguage();
  const tr = (
    key: keyof typeof requestsMessages,
    params?: Record<string, string | number>,
  ) => t(language, requestsMessages, key, params);
  const items = await requests.listMyRequests
    .execute(actor)
    .catch(mapPageError);
  return (
    <div className="section-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{tr("onlineOffice")}</p>
          <h1>{tr("requests")}</h1>
          <p className="page-lead">{tr("requestsLead")}</p>
        </div>
        <Button asChild>
          <Link href="/requests/new">
            <Plus aria-hidden="true" />
            {tr("newRequest")}
          </Link>
        </Button>
      </div>
      {items.length ? (
        <ul className="grid min-w-0 gap-4 lg:grid-cols-2">
          {items.map((item) => (
            <li key={item.id}>
              <Card className="h-full rounded-feature">
                <CardContent className="space-y-4">
                  <RequestStageBar status={item.status} />
                  <div className="flex flex-wrap gap-2">
                    <RequestStatusBadge status={item.status} />
                    <RequestSlaBadge sla={item.sla} />
                  </div>
                  <div>
                    <h2 className="text-lg">
                      <Link
                        href={`/requests/${item.id}`}
                        className="inline-flex min-h-11 items-center rounded-sm font-semibold underline decoration-border underline-offset-4"
                      >
                        {requestTypeTitle(language, item.type)}
                      </Link>
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {item.publicNo ?? tr("draftUnsent")}
                    </p>
                  </div>
                  <p className="text-sm">
                    {item.dueAt
                      ? tr("expectedDate", {
                          date: formatRequestDate(item.dueAt, true, language),
                        })
                      : tr("deadlineLater")}
                  </p>
                  <Button asChild variant="outline">
                    <Link href={`/requests/${item.id}`}>
                      {item.status === "draft"
                        ? tr("continueDraft")
                        : tr("trackRequest")}
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <Card>
          <EmptyState
            icon={FileText}
            title={tr("noRequests")}
            description={tr("noRequestsHelp")}
            action={
              <Button asChild>
                <Link href="/requests/new">{tr("chooseType")}</Link>
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
}
