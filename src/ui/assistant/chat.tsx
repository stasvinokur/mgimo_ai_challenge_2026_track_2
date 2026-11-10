"use client";

import { ArrowUp, BookOpen, LoaderCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AssistantEvent, DraftCard } from "@/application/assistant/ports";
import { assistantMessages } from "@/ui/i18n/dictionaries/assistant";
import { formatDate, formatNumber } from "@/ui/i18n/format";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { StatusBadge } from "@/ui/primitives/status-badge";
import { RegulationMarkdown } from "@/ui/regulations/markdown";
import type {
  RequestProfileAction,
  RequestProfileDto,
} from "@/ui/requests/profile-fields";
import {
  assistantMessage,
  draftFieldTitle,
  draftFieldValue,
  draftTitle,
  workingDays,
} from "./presentation";
import type { AssistantChat } from "./use-assistant";

const quickQuestionKeys = [
  "nextQuestion",
  "changesQuestion",
  "debtsQuestion",
  "certificateQuestion",
] as const;

export function AssistantDraftCard({
  draft,
  disabled,
  decided,
  onDecision,
  close,
  profile,
  profileError,
  retryProfile,
  sent,
  submission,
  pendingDecision = null,
  position = 1,
}: {
  position?: number;
  profile: RequestProfileDto | null;
  profileError: boolean;
  retryProfile: () => void;
  sent: boolean;
  submission?: Extract<AssistantEvent, { type: "submitted" }>;
  pendingDecision?: "approve" | "decline" | null;
  draft: DraftCard;
  disabled: boolean;
  decided: boolean;
  onDecision: (id: string, approved: boolean) => void;
  close: () => void;
}) {
  const language = useLanguage();
  const titleId = useId();
  const draftLabelId = `${titleId}-draft-label`;
  const profileLabelId = `${titleId}-profile-label`;
  const number = formatNumber(language, position);
  const tr = (
    key: keyof typeof assistantMessages,
    params?: Record<string, string | number>,
  ) => t(language, assistantMessages, key, params);
  return (
    <Card
      className="min-w-0 gap-4 overflow-hidden rounded-feature border-primary/30 py-0 shadow-lg"
      data-assistant-draft={position}
      role="region"
      aria-labelledby={`${draftLabelId} ${titleId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 bg-accent px-4 py-3 text-xs font-bold text-accent-foreground">
        <span>{sent ? tr("sent") : tr("unsent")}</span>
        <span>{workingDays(language, draft.slaWorkDays)}</span>
      </div>
      <CardHeader className="px-4">
        <span id={draftLabelId} className="sr-only">
          {tr("draftRegion", { number })}
        </span>
        <CardTitle>
          <h3 id={titleId} className="text-lg font-extrabold">
            {draftTitle(language, draft)}
          </h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-4">
        <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm">
          {draft.fields.map((field) => (
            <div key={field.title} className="min-w-0">
              <dt className="text-muted-foreground">
                {draftFieldTitle(language, field)}
                {field.required ? tr("required") : tr("optional")}
              </dt>
              <dd className="whitespace-pre-wrap break-words font-semibold">
                {draftFieldValue(language, field) || tr("notSpecified")}
              </dd>
            </div>
          ))}
          {draft.lessons && (
            <div className="col-span-2 min-w-0">
              <dt className="text-muted-foreground">{tr("eventLessons")}</dt>
              <dd className="whitespace-pre-wrap font-semibold">
                {draft.lessons.length
                  ? draft.lessons
                      .map(
                        (lesson) =>
                          `${lesson.course} · ${formatDate(language, lesson.startsAt, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} ${tr("moscow")} · ${lesson.room}`,
                      )
                      .join("\n")
                  : tr("noEventLessons")}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-muted-foreground">{tr("delivery")}</dt>
            <dd className="font-semibold">{tr(draft.delivery)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{tr("submitToday")}</dt>
            <dd className="font-semibold">
              {tr("expected", {
                date: formatDate(language, draft.expectedAt, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }),
              })}
            </dd>
          </div>
        </dl>
        <section
          aria-labelledby={`${profileLabelId} ${titleId}`}
          className="rounded-xl bg-secondary p-3"
        >
          <span id={profileLabelId} className="sr-only">
            {tr("profileRegion", { number })}
          </span>
          <p className="mb-3 text-xs font-medium">{tr("profileNote")}</p>
          {profile ? (
            <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2">
              {[
                [tr("fullName"), profile.fullName],
                [tr("faculty"), profile.faculty],
                [tr("program"), profile.program],
                [
                  tr("courseGroup"),
                  tr("courseValue", {
                    course: profile.course,
                    group: profile.group,
                  }),
                ],
                [tr("recordBook"), profile.recordBookNo],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          ) : profileError ? (
            <div role="alert" className="space-y-2 text-sm">
              <p>{tr("profileError")}</p>
              <Button variant="outline" onClick={retryProfile}>
                {tr("retryProfile")}
              </Button>
            </div>
          ) : (
            <p role="status" className="animate-pulse text-sm">
              {tr("loadingProfile")}
            </p>
          )}
        </section>
        <Link
          className="inline-flex min-h-11 items-center text-sm text-primary underline"
          href={draft.source.href}
        >
          {tr("basis", { section: draft.source.section })}
        </Link>
        {!draft.canSubmit && (
          <p className="text-sm text-muted-foreground">
            {tr("completeFields")}
          </p>
        )}
        <div className="flex min-h-40 flex-col gap-2">
          {decided ? (
            <>
              <p
                role="status"
                className="flex min-h-11 items-center text-sm font-medium"
              >
                {sent
                  ? submission?.publicNo
                    ? tr("sentNumber", { number: submission.publicNo })
                    : tr("sent")
                  : tr("unavailableDraft")}
              </p>
              {submission && (
                <Button
                  asChild
                  className="h-auto min-h-11 whitespace-normal rounded-xl"
                >
                  <Link onClick={close} href={`/requests/${submission.id}`}>
                    {tr("openRequest", { number: submission.publicNo ?? "" })}
                  </Link>
                </Button>
              )}
            </>
          ) : (
            <>
              {draft.canSubmit && draft.approvalId && (
                <>
                  <Button
                    className="rounded-xl"
                    disabled={disabled || !profile || pendingDecision !== null}
                    aria-busy={pendingDecision !== null}
                    onClick={() =>
                      draft.approvalId && onDecision(draft.approvalId, true)
                    }
                  >
                    {pendingDecision === "approve"
                      ? tr("sending")
                      : pendingDecision === "decline"
                        ? tr("savingDecision")
                        : tr("confirm")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={disabled || pendingDecision !== null}
                    onClick={() =>
                      draft.approvalId && onDecision(draft.approvalId, false)
                    }
                  >
                    {tr("decline")}
                  </Button>
                </>
              )}
              {disabled || pendingDecision !== null ? (
                <Button variant="outline" className="rounded-xl" disabled>
                  {tr("edit")}
                </Button>
              ) : (
                <Button variant="outline" className="rounded-xl" asChild>
                  <Link href={draft.href} onClick={close}>
                    {tr("edit")}
                  </Link>
                </Button>
              )}
            </>
          )}
        </div>
        <p
          aria-hidden={decided}
          className={`flex items-start gap-2 text-xs text-muted-foreground ${decided ? "invisible" : ""}`}
        >
          <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
          {tr("humanConfirmation")}
        </p>
      </CardContent>
    </Card>
  );
}

export function AssistantChatPanel({
  chat,
  close,
  requestProfileAction,
}: {
  chat: AssistantChat;
  close: () => void;
  requestProfileAction?: RequestProfileAction;
}) {
  const language = useLanguage();
  const tr = (
    key: keyof typeof assistantMessages,
    params?: Record<string, string | number>,
  ) => t(language, assistantMessages, key, params);
  const quickQuestions = quickQuestionKeys.map((key) => tr(key));
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const { messages, sendMessage, status, error, clearError } = chat;
  const pathname = usePathname();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const decisionScrollLock = useRef<{
    through: number;
    question: string;
  } | null>(null);
  const [pendingDecision, setPendingDecision] = useState<{
    approvalId: string;
    approved: boolean;
  } | null>(null);
  const [profile, setProfile] = useState<RequestProfileDto | null>(null);
  const [profileError, setProfileError] = useState(false);
  const busy = status === "submitted" || status === "streaming";
  const allData = messages.flatMap((message) =>
    message.parts
      .filter((part) => part.type === "data-assistant")
      .map((part) => part.data),
  );
  const submitted = new Map(
    allData
      .filter((event) => event.type === "submitted")
      .map((event) => [event.id, event]),
  );
  const declined = new Set(
    allData.flatMap((event) =>
      event.type === "declined" ? [event.approvalId] : [],
    ),
  );
  const drafts = allData.filter((event) => event.type === "draft");
  const latestDraft = drafts.at(-1)?.draft;
  const latestDraftById = new Map(
    drafts.map((event) => [event.draft.id, event]),
  );
  const hasDraft = Boolean(latestDraft);
  const loadProfile = useCallback(async () => {
    setProfileError(false);
    try {
      if (!requestProfileAction) throw new Error("PROFILE_ACTION_UNAVAILABLE");
      const result = await requestProfileAction();
      if (result.ok) setProfile(result.profile);
      else setProfileError(true);
    } catch {
      setProfileError(true);
    }
  }, [requestProfileAction]);
  useEffect(() => {
    if (hasDraft) void loadProfile();
  }, [hasDraft, loadProfile]);
  const userMessages = messages.filter((message) => message.role === "user");
  const userMessageCount = userMessages.length;
  const latestQuestion =
    userMessages
      .at(-1)
      ?.parts.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("") ?? "";
  const selectedQuestion =
    decisionScrollLock.current &&
    userMessageCount <= decisionScrollLock.current.through
      ? decisionScrollLock.current.question
      : latestQuestion;
  useEffect(() => {
    // Approval messages must not move another control under a second tap.
    if (
      decisionScrollLock.current !== null &&
      userMessageCount <= decisionScrollLock.current.through
    )
      return;
    decisionScrollLock.current = null;
    if (messages.length || status)
      end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, status, userMessageCount]);
  const ask = (question: string) => {
    if (!question.trim() || busy || sending.current) return;
    sending.current = true;
    decisionScrollLock.current = null;
    clearError();
    setLastQuestion(question);
    setInput("");
    void sendMessage({ text: question }).finally(() => {
      sending.current = false;
    });
  };
  let draftPosition = 0;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4 sm:px-6"
      data-assistant-ready={ready ? "true" : undefined}
    >
      <Link
        href="/profile/assistant"
        prefetch={false}
        onClick={close}
        onNavigate={(event) => {
          if (pathname === "/profile/assistant") {
            event.preventDefault();
            router.refresh();
          }
        }}
        className="inline-flex min-h-11 shrink-0 items-center self-start text-sm text-primary underline"
      >
        {tr("myJournal")}
      </Link>
      <fieldset className="flex shrink-0 flex-wrap gap-2">
        <legend className="sr-only">{tr("quickQuestions")}</legend>
        {quickQuestions.map((question) => (
          <Button
            key={question}
            size="sm"
            variant={selectedQuestion === question ? "secondary" : "outline"}
            className={`h-auto min-h-11 rounded-full whitespace-normal text-left ${selectedQuestion === question ? "border border-primary bg-accent font-bold text-accent-foreground" : "bg-background dark:bg-background"}`}
            aria-pressed={selectedQuestion === question}
            disabled={busy}
            onClick={() => ask(question)}
          >
            {question}
          </Button>
        ))}
      </fieldset>
      <div
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pb-2 pr-1"
        role="log"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable text-only history needs a tab stop for keyboard scrolling.
        tabIndex={0}
        aria-live="polite"
        aria-label={tr("conversation")}
        aria-relevant="additions text"
      >
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">{tr("introduction")}</p>
        )}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`min-w-0 space-y-3 ${message.role === "user" ? "ml-auto max-w-[90%] rounded-feature rounded-br-sm bg-primary p-3 text-primary-foreground [&_a]:text-primary-foreground" : "mr-auto rounded-feature rounded-bl-sm bg-background p-3"}`}
          >
            <p
              className={`text-xs font-medium ${message.role === "user" ? "sr-only" : "text-muted-foreground"}`}
            >
              {message.role === "user" ? tr("you") : tr("assistant")}
            </p>
            {message.parts.map((part) => {
              if (part.type === "text")
                return (
                  <RegulationMarkdown key={`${message.id}-text`}>
                    {part.text}
                  </RegulationMarkdown>
                );
              if (part.type !== "data-assistant") return null;
              const event = part.data;
              const key = `${message.id}-${part.id ?? event.type}`;
              if (event.type === "message")
                return (
                  <p key={key} className="whitespace-pre-wrap text-sm">
                    {assistantMessage(language, event)}
                  </p>
                );
              if (event.type === "mode")
                return (
                  <StatusBadge key={key} tone="warning">
                    {tr("fallbackMode")}
                  </StatusBadge>
                );
              if (event.type === "source")
                return (
                  <div key={key} className="space-y-2 text-sm">
                    <Link
                      onClick={close}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--info-bg)] px-3 py-2 font-semibold text-[var(--info-ink)] underline-offset-4 hover:underline"
                      href={event.source.href}
                    >
                      <BookOpen
                        aria-hidden="true"
                        className="size-4 shrink-0"
                      />
                      § {event.source.section} {event.source.documentTitle}
                    </Link>
                    {language === "en" && (
                      <p className="text-xs text-muted-foreground">
                        {tr("russianSource")}
                      </p>
                    )}
                    <RegulationMarkdown>
                      {event.source.excerpt
                        .replaceAll("[[[", "")
                        .replaceAll("]]]", "")}
                    </RegulationMarkdown>
                  </div>
                );
              if (event.type === "submitted")
                return latestDraftById.has(event.id) ? null : (
                  <Button key={key} asChild>
                    <Link onClick={close} href={`/requests/${event.id}`}>
                      {tr("openRequest", { number: event.publicNo ?? "" })}
                    </Link>
                  </Button>
                );
              if (event.type === "draft") {
                draftPosition += 1;
                return (
                  <AssistantDraftCard
                    key={key}
                    position={draftPosition}
                    draft={event.draft}
                    close={close}
                    profile={profile}
                    profileError={profileError}
                    retryProfile={() => void loadProfile()}
                    sent={submitted.has(event.draft.id)}
                    submission={
                      latestDraftById.get(event.draft.id) === event
                        ? submitted.get(event.draft.id)
                        : undefined
                    }
                    pendingDecision={
                      pendingDecision &&
                      pendingDecision.approvalId === event.draft.approvalId
                        ? pendingDecision.approved
                          ? "approve"
                          : "decline"
                        : null
                    }
                    disabled={busy}
                    decided={
                      submitted.has(event.draft.id) ||
                      (event.draft.approvalId !== undefined &&
                        declined.has(event.draft.approvalId)) ||
                      latestDraft?.approvalId !== event.draft.approvalId
                    }
                    onDecision={(approvalId, approved) => {
                      if (busy || sending.current) return;
                      sending.current = true;
                      decisionScrollLock.current = {
                        through: userMessageCount + 1,
                        question: selectedQuestion,
                      };
                      setPendingDecision({ approvalId, approved });
                      clearError();
                      void sendMessage(
                        {
                          text: approved ? tr("confirm") : tr("decline"),
                        },
                        { body: { action: "approve", approvalId, approved } },
                      ).finally(() => {
                        sending.current = false;
                        setPendingDecision(null);
                      });
                    }}
                  />
                );
              }
              return null;
            })}
          </article>
        ))}
        {busy && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            {tr("thinking")}
          </p>
        )}
        <div ref={end} />
      </div>
      {error && (
        <div role="alert" className="space-y-2 rounded-xl border p-3 text-sm">
          <p>
            {error.message === "ASSISTANT_BUSY"
              ? tr("busy")
              : error.message === "429"
                ? tr("rateLimited")
                : error.message === "401"
                  ? tr("signInAgain")
                  : tr("answerError")}
          </p>
          {error.message === "401" ? (
            <Button asChild variant="outline">
              <Link href="/login">{tr("signIn")}</Link>
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => ask(lastQuestion)}
            >
              {tr("retryQuestion")}
            </Button>
          )}
        </div>
      )}
      <form
        className="flex shrink-0 items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          ask(input);
        }}
      >
        <div className="min-w-0 flex-1">
          <label
            htmlFor="assistant-question"
            className="mb-1 block text-sm font-medium"
          >
            {tr("question")}
          </label>
          <textarea
            id="assistant-question"
            rows={2}
            maxLength={2000}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="min-h-12 w-full resize-none rounded-xl border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            placeholder={tr("placeholder")}
          />
        </div>
        <Button
          type="submit"
          size="icon-lg"
          className="rounded-xl"
          disabled={busy || !input.trim()}
          aria-label={tr("ask")}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}
