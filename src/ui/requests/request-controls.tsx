"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { RequestStatus } from "@/application/requests/dto";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { requestErrorMessage } from "./translations";

export function RequestControls({
  id,
  status,
  change,
}: {
  id: string;
  status: RequestStatus;
  change(
    input: unknown,
  ): Promise<
    { ok: true } | { ok: false; error: { code?: string; message: string } }
  >;
}) {
  const language = useLanguage();
  const tr = (key: keyof typeof requestsMessages) =>
    t(language, requestsMessages, key);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  if (status !== "submitted" && status !== "needs_info") return null;
  function send(to: RequestStatus, comment?: string) {
    start(async () => {
      setError(null);
      try {
        const result = await change({
          id,
          to,
          ...(comment !== undefined ? { comment } : {}),
        });
        if (!result.ok) setError(requestErrorMessage(language, result.error));
        else router.refresh();
      } catch {
        setError(tr("error_INTERNAL_ERROR"));
      }
    });
  }
  return (
    <section
      aria-label={tr("actions")}
      className="space-y-4 [overflow-wrap:normal] rounded-xl border bg-card p-5"
    >
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {status === "needs_info" ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            send("in_progress", String(data.get("comment") ?? ""));
          }}
        >
          <h2>{tr("replyHeading")}</h2>
          <label htmlFor="request-reply" className="block text-sm">
            {tr("replyRequired")}
          </label>
          <textarea
            id="request-reply"
            name="comment"
            required
            maxLength={2000}
            rows={4}
            className="w-full rounded-lg border bg-background p-3"
          />
          <Button disabled={pending} type="submit">
            {pending ? tr("sending") : tr("sendReply")}
          </Button>
        </form>
      ) : confirm ? (
        <div className="space-y-3">
          <p>{tr("cancelQuestion")}</p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => send("cancelled")}
            >
              {tr("confirmCancellation")}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setConfirm(false)}
            >
              {tr("keepWaiting")}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setConfirm(true)}>
          {tr("cancelRequest")}
        </Button>
      )}
    </section>
  );
}
