"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  useTransition,
} from "react";
import type { RequestTypeDto } from "@/application/requests/dto";
import type { FieldErrors } from "@/application/shared/errors";
import type { StudentProfile } from "@/application/student/ports";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { StageBar } from "@/ui/primitives/stage-bar";
import { EventLessonList } from "./event-lessons";
import { deliveryLabel, formatRequestFieldValue, workDays } from "./format";
import { ProfileFields } from "./profile-fields";
import {
  createRequestFormState,
  requestFormReducer,
} from "./request-form-state";

import {
  requestErrorMessage,
  requestFieldError,
  requestFieldTitle,
  requestTypeTitle,
} from "./translations";

type Failure = {
  ok: false;
  error: { code?: string; message: string; fieldErrors?: FieldErrors };
};
export interface RequestFormActions {
  save(input: unknown): Promise<
    | Failure
    | {
        ok: true;
        id: string;
        payload: Record<string, unknown>;
        review: boolean;
      }
  >;
  submit(id: string): Promise<Failure | { ok: true; id: string }>;
  remove(id: string): Promise<Failure | { ok: true }>;
}
export function RequestForm({
  type,
  profile,
  draft,
  initialPayload,
  actions,
}: {
  type: RequestTypeDto;
  profile: StudentProfile;
  draft?: { id: string; payload: Record<string, unknown> };
  initialPayload?: Record<string, unknown>;
  actions: RequestFormActions;
}) {
  const language = useLanguage();
  const tr = (
    key: keyof typeof requestsMessages,
    params?: Record<string, string | number>,
  ) => t(language, requestsMessages, key, params);
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const prefix = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const [pending, start] = useTransition();
  const [{ id, payload, revision, review, saved, dirty }, dispatch] =
    useReducer(
      requestFormReducer,
      draft ?? (initialPayload ? { payload: initialPayload } : undefined),
      createRequestFormState,
    );
  const [error, setError] = useState<Failure["error"] | null>(null);
  useEffect(() => {
    if (review) heading.current?.focus();
  }, [review]);
  useEffect(() => {
    if (error?.fieldErrors)
      form.current
        ?.querySelector<HTMLTextAreaElement>('[aria-invalid="true"]')
        ?.focus();
  }, [error]);
  function perform(operation: () => Promise<void>) {
    if (pending || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    dispatch({ type: "started" });
    start(async () => {
      try {
        await operation();
      } catch {
        setError({
          code: "INTERNAL_ERROR",
          message: "",
        });
      } finally {
        inFlight.current = false;
      }
    });
  }
  function save(check: boolean) {
    perform(async () => {
      const result = await actions.save({
        ...(id ? { id } : {}),
        typeCode: type.code,
        payload,
        review: check,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      dispatch({ type: "saved", revision, draft: result });
    });
  }
  return (
    <Card
      className="overflow-hidden rounded-feature [overflow-wrap:normal]"
      data-testid="request-form"
      data-ready={ready ? "true" : undefined}
    >
      <CardHeader>
        <div
          role="img"
          aria-label={tr("formStageProgress", {
            current: review ? 2 : 1,
            total: 2,
          })}
        >
          <div aria-hidden="true">
            <StageBar total={2} current={review ? 2 : 1} tone="info" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {tr("step", { step: review ? 2 : 1 })}
        </p>
        <CardTitle>
          <h2 ref={heading} tabIndex={-1}>
            {review ? tr("reviewRequest") : requestTypeTitle(language, type)}
          </h2>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {tr(review ? "confirmNotice" : "draftNotice")}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <section
          aria-label={tr("profileData")}
          className="rounded-xl bg-secondary p-4"
        >
          <p className="mb-4 text-sm font-medium">{tr("profileAutomatic")}</p>
          <ProfileFields profile={profile} />
        </section>
        <p className="text-sm">
          {requestTypeTitle(language, type)} ·{" "}
          {workDays(type.slaWorkDays, language)} {tr("afterSubmission")} ·{" "}
          {deliveryLabel(type.delivery, language)}
        </p>
        {language === "en" && (
          <p className="text-sm text-muted-foreground">
            {tr("russianSubmission")}
          </p>
        )}
        {type.code === "event_release" && (
          <p className="text-sm text-muted-foreground">
            {tr("eventDateRules")}
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-destructive p-4 text-sm text-destructive"
          >
            {requestErrorMessage(language, error)}
          </div>
        )}
        {saved && (
          <div className="space-y-2">
            <p role="status" className="text-sm text-primary">
              {tr("savedDraft")}
            </p>
            {id && (
              <Button asChild variant="link">
                <Link href={`/requests/${id}`}>{tr("openDraft")}</Link>
              </Button>
            )}
          </div>
        )}
        {dirty && (
          <p role="status" className="text-sm text-muted-foreground">
            {tr("unsavedChanges")}
          </p>
        )}
        {review ? (
          <div className="space-y-6">
            <dl className="grid min-w-0 gap-4 rounded-xl border p-4 sm:grid-cols-2">
              {type.fields.map((field) => (
                <div key={field.name}>
                  <dt className="text-sm text-muted-foreground">
                    {requestFieldTitle(language, field)}
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words font-semibold">
                    {typeof payload[field.name] === "string" &&
                    payload[field.name]
                      ? formatRequestFieldValue(
                          field,
                          String(payload[field.name]),
                          language,
                        )
                      : tr("notSpecified")}
                  </dd>
                </div>
              ))}
            </dl>
            <EventLessonList
              audience="student"
              typeCode={type.code}
              payload={payload}
            />
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={pending || !id}
                onClick={() =>
                  perform(async () => {
                    if (!id) return;
                    const result = await actions.submit(id);
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    router.push(`/requests/${result.id}`);
                    router.refresh();
                  })
                }
              >
                {tr(pending ? "sending" : "confirmSubmission")}
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => dispatch({ type: "edit" })}
              >
                {tr("editDetails")}
              </Button>
            </div>
          </div>
        ) : (
          <form
            ref={form}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              save(true);
            }}
            className="space-y-5"
            aria-busy={pending}
          >
            {type.fields.map((field) => {
              const fieldId = `${prefix}-${field.name}`;
              const errors = error?.fieldErrors?.[field.name];
              return (
                <div key={field.name} className="space-y-2">
                  <label
                    htmlFor={fieldId}
                    className="block text-sm font-medium"
                  >
                    {requestFieldTitle(language, field)}
                    {tr(field.required ? "required" : "optional")}
                  </label>
                  {field.format === "date" ? (
                    <input
                      type="date"
                      id={fieldId}
                      name={field.name}
                      required={field.required}
                      value={String(payload[field.name] ?? "")}
                      onChange={(event) =>
                        dispatch({
                          type: "changed",
                          name: field.name,
                          value: event.target.value,
                        })
                      }
                      aria-invalid={Boolean(errors?.length)}
                      aria-describedby={
                        errors?.length ? `${fieldId}-error` : undefined
                      }
                      className="min-h-12 w-full min-w-0 max-w-full rounded-xl border bg-background px-3 py-3 text-base"
                    />
                  ) : (
                    <textarea
                      id={fieldId}
                      name={field.name}
                      required={field.required}
                      maxLength={field.maxLength}
                      rows={field.maxLength > 500 ? 5 : 2}
                      value={String(payload[field.name] ?? "")}
                      onChange={(event) =>
                        dispatch({
                          type: "changed",
                          name: field.name,
                          value: event.target.value,
                        })
                      }
                      aria-invalid={Boolean(errors?.length)}
                      aria-describedby={
                        errors?.length ? `${fieldId}-error` : undefined
                      }
                      className={`min-h-12 w-full rounded-xl border bg-background px-3 py-3 text-base${type.code === "question" && field.name === "question" && initialPayload?.question ? " max-h-240 [field-sizing:content]" : ""}`}
                    />
                  )}
                  {errors?.length ? (
                    <p
                      id={`${fieldId}-error`}
                      className="text-sm text-destructive"
                    >
                      {errors
                        .map((message) =>
                          requestFieldError(language, message, field),
                        )
                        .join(" ")}
                    </p>
                  ) : null}
                </div>
              );
            })}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={pending}>
                {tr(pending ? "saving" : "checkRequest")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => save(false)}
              >
                {tr("saveDraft")}
              </Button>
              {id && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    perform(async () => {
                      const result = await actions.remove(id);
                      if (!result.ok) {
                        setError(result.error);
                        return;
                      }
                      router.push("/requests");
                      router.refresh();
                    })
                  }
                >
                  {tr("deleteDraft")}
                </Button>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
