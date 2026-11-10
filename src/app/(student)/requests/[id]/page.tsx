import Link from "next/link";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { NotFoundError } from "@/application/shared/errors";
import { certificates, requests } from "@/composition/container";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { CertificateCard } from "@/ui/requests/certificate-card";
import { EventLessonList } from "@/ui/requests/event-lessons";
import {
  deliveryLabel,
  formatRequestDate,
  formatRequestFieldValue,
} from "@/ui/requests/format";
import { PickupCard } from "@/ui/requests/pickup-card";
import { RequestControls } from "@/ui/requests/request-controls";
import { RequestForm } from "@/ui/requests/request-form";
import {
  RequestSlaBadge,
  RequestStatusBadge,
} from "@/ui/requests/request-status";
import {
  getRequestExplanation,
  RequestTimeline,
} from "@/ui/requests/request-timeline";
import {
  requestFieldTitle,
  requestTypeTitle,
} from "@/ui/requests/translations";
import {
  changeRequestStatusAction,
  deleteRequestDraftAction,
  saveRequestDraftAction,
  submitRequestAction,
} from "../actions";
import { bookPickupAction, cancelPickupAction } from "../pickup-actions";

export async function generateMetadata() {
  await requireStudent();
  return { title: t(await getLanguage(), requestsMessages, "request") };
}
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStudent();
  const language = await getLanguage();
  const tr = (
    key: keyof typeof requestsMessages,
    params?: Record<string, string | number>,
  ) => t(language, requestsMessages, key, params);
  const { id } = await params;
  const request = await requests.getMyRequest
    .execute(actor, { id })
    .catch(mapPageError);
  const catalog =
    request.status === "draft"
      ? await requests.getCatalog.execute(actor).catch(mapPageError)
      : null;
  const certificate =
    request.type.isCertificate && ["ready", "issued"].includes(request.status)
      ? await certificates.card
          .execute(actor, { id })
          .catch((error: unknown) => {
            if (error instanceof NotFoundError) return null;
            return mapPageError(error);
          })
      : null;
  const pickup =
    request.type.delivery === "pickup" &&
    request.type.isCertificate &&
    request.status === "ready"
      ? await requests.getPickup.execute(actor, { id }).catch(mapPageError)
      : null;
  return (
    <div className="section-page">
      <div>
        <Button variant="link" asChild>
          <Link href="/requests">{tr("myRequests")}</Link>
        </Button>
        <p className="eyebrow">{request.publicNo ?? tr("draftUnsent")}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 basis-full font-extrabold [overflow-wrap:normal] sm:flex-1 sm:basis-0">
            {requestTypeTitle(language, request.type)}
          </h1>
          <RequestStatusBadge status={request.status} />
        </div>
        {request.status !== "draft" && (
          <div className="mt-3 space-y-1">
            <h2 className="text-sm text-muted-foreground">{tr("happening")}</h2>
            <p className="text-sm text-muted-foreground">
              {certificate?.revoked
                ? tr("certificateRevoked")
                : request.type.delivery === "pickup" &&
                    request.type.isCertificate &&
                    ["ready", "issued"].includes(request.status)
                  ? request.status === "issued"
                    ? tr("certificateIssued")
                    : tr("certificatePickupReady")
                  : certificate
                    ? tr("certificatePdfReady")
                    : getRequestExplanation(
                        request.status,
                        request.type,
                        language,
                      )}
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <RequestSlaBadge sla={request.sla} />
      </div>
      {request.status === "draft" && catalog ? (
        <RequestForm
          type={request.type}
          profile={catalog.profile}
          draft={{ id: request.id, payload: request.payload }}
          actions={{
            save: saveRequestDraftAction,
            submit: submitRequestAction,
            remove: deleteRequestDraftAction,
          }}
        />
      ) : (
        <>
          <RequestTimeline request={request} language={language} />
          {pickup && (
            <PickupCard
              requestId={id}
              data={pickup}
              book={bookPickupAction}
              cancel={cancelPickupAction}
            />
          )}
          <EventLessonList
            audience="student"
            typeCode={request.type.code}
            payload={request.payload}
          />
          {certificate && (
            <CertificateCard
              id={request.id}
              certificate={certificate}
              typeCode={request.type.code}
            />
          )}
          <Card className="rounded-feature">
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">
                    {tr("expectedDateLabel")}
                  </dt>
                  <dd>
                    {request.dueAt
                      ? tr("dateWithZone", {
                          date: formatRequestDate(
                            request.dueAt,
                            true,
                            language,
                          ),
                        })
                      : tr("beingConfirmed")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{tr("delivery")}</dt>
                  <dd>{deliveryLabel(request.type.delivery, language)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{tr("assignee")}</dt>
                  <dd>{request.assignee ?? tr("unassigned")}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          <RequestControls
            id={request.id}
            status={request.status}
            change={changeRequestStatusAction}
          />
          <Card className="rounded-feature">
            <CardHeader>
              <CardTitle>
                <h2>{tr("requestDetails")}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-4">
                {request.type.fields.map((field) => (
                  <div key={field.name}>
                    <dt className="text-sm text-muted-foreground">
                      {requestFieldTitle(language, field)}
                    </dt>
                    <dd className="whitespace-pre-wrap break-words">
                      {formatRequestFieldValue(
                        field,
                        String(
                          request.payload[field.name] ?? tr("notSpecified"),
                        ),
                        language,
                      ) || tr("notSpecified")}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
