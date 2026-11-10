import { FileText } from "lucide-react";
import Link from "next/link";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { NotFoundError } from "@/application/shared/errors";
import { grades, requests } from "@/composition/container";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { EmptyState } from "@/ui/primitives/empty-state";
import { StatusBadge } from "@/ui/primitives/status-badge";
import { deliveryLabel, workDays } from "@/ui/requests/format";
import { RequestForm } from "@/ui/requests/request-form";
import {
  requestTypeDescription,
  requestTypeTitle,
} from "@/ui/requests/translations";
import {
  deleteRequestDraftAction,
  saveRequestDraftAction,
  submitRequestAction,
} from "../../actions";

export async function generateMetadata() {
  await requireStudent();
  return { title: t(await getLanguage(), requestsMessages, "newRequest") };
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; courseId?: string; workId?: string }>;
}) {
  const actor = await requireStudent();
  const language = await getLanguage();
  const tr = (
    key: keyof typeof requestsMessages,
    params?: Record<string, string | number>,
  ) => t(language, requestsMessages, key, params);
  const catalog = await requests.getCatalog.execute(actor).catch(mapPageError);
  const { type: code, courseId, workId } = await searchParams;
  const type = code ? catalog.types.find((item) => item.code === code) : null;
  if (code && !type) mapPageError(new NotFoundError());
  const plan =
    type?.code === "question" && courseId !== undefined
      ? await grades.getCourseActions
          .execute(actor, {
            courseId,
            ...(workId !== undefined ? { workId } : {}),
          })
          .catch((error: unknown) => {
            if (error instanceof NotFoundError) return null;
            return mapPageError(error);
          })
      : null;
  return (
    <div className="section-page">
      <div>
        <Button variant="link" asChild>
          <Link href={type ? "/requests/new" : "/requests"}>
            {type ? tr("allTypes") : tr("myRequests")}
          </Link>
        </Button>
        <p className="eyebrow">{tr("onlineOffice")}</p>
        <h1>{tr("newRequest")}</h1>
        <p className="page-lead">{tr("catalogLead")}</p>
      </div>
      {type ? (
        <RequestForm
          key={`${type.code}:${courseId ?? ""}:${workId ?? ""}`}
          type={type}
          profile={catalog.profile}
          initialPayload={plan ? { question: plan.appeal.question } : undefined}
          actions={{
            save: saveRequestDraftAction,
            submit: submitRequestAction,
            remove: deleteRequestDraftAction,
          }}
        />
      ) : catalog.types.length ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {catalog.types.map((type) => (
            <Card key={type.code} className="rounded-feature gap-4">
              <CardHeader>
                <CardTitle>
                  <h2 className="text-lg font-bold">
                    {requestTypeTitle(language, type)}
                  </h2>
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {requestTypeDescription(language, type)}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone="info">
                    {workDays(type.slaWorkDays, language)}
                  </StatusBadge>
                  <StatusBadge tone="neutral">
                    {deliveryLabel(type.delivery, language)}
                  </StatusBadge>
                </div>
                <Button
                  asChild
                  variant="outline"
                  className="h-auto max-w-full whitespace-normal text-left [overflow-wrap:normal]"
                >
                  <Link
                    href={`/requests/new?type=${encodeURIComponent(type.code)}`}
                  >
                    {tr("choose", { title: requestTypeTitle(language, type) })}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={FileText}
            title={tr("catalogEmpty")}
            description={tr("catalogEmptyHelp")}
            action={
              <Button asChild variant="outline">
                <Link href="/requests">{tr("toRequests")}</Link>
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
}
