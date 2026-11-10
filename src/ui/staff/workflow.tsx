"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import {
  type StaffQueueCardDto,
  type StaffTarget,
  staffActions,
  staffCommentOptions,
} from "@/application/staff/dto";
import { Button } from "@/ui/primitives/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/ui/primitives/sheet";

export type StaffChangeAction = (input: unknown) => Promise<
  | { ok: true }
  | {
      ok: false;
      error: {
        message: string;
        fieldErrors?: Readonly<Record<string, readonly string[]>>;
      };
    }
>;
export function StaffActionButtons({
  request,
  choose,
  pending,
}: {
  request: StaffQueueCardDto;
  choose: (request: StaffQueueCardDto, to: StaffTarget) => void;
  pending: boolean;
}) {
  const primary = request.actions.find(
    (to) => to !== "rejected" && to !== "needs_info",
  );
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">Действия по заявке {request.publicNo}</legend>
      {request.actions.map((to) => (
        <Button
          key={to}
          size="sm"
          variant={to === primary ? "default" : "outline"}
          className="h-auto grow basis-auto rounded-xl px-3 py-2 whitespace-nowrap [overflow-wrap:normal]"
          disabled={pending}
          onClick={() => choose(request, to)}
        >
          {staffActions[to].label}
        </Button>
      ))}
      {!request.actions.length && (
        <p className="text-sm text-muted-foreground">
          {request.status === "needs_info"
            ? "Ждём ответ студента"
            : "Доступных действий нет"}
        </p>
      )}
    </fieldset>
  );
}

export function useStaffWorkflow(
  change: StaffChangeAction,
  demoCommentsOnly: boolean,
) {
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<{
    request: StaffQueueCardDto;
    to: "needs_info" | "rejected";
  } | null>(null);
  const [comment, setComment] = useState("");
  const [commentCode, setCommentCode] = useState("");
  const [review, setReview] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const opener = useRef<HTMLElement | null>(null);

  function send(request: StaffQueueCardDto, to: StaffTarget, text?: string) {
    start(async () => {
      setError("");
      setFieldError("");
      try {
        const result = await change({
          id: request.id,
          to,
          ...(text !== undefined
            ? demoCommentsOnly
              ? { commentCode }
              : { comment: text }
            : {}),
        });
        if (!result.ok) {
          const commentError = result.error.fieldErrors?.comment?.join(" ");
          if (commentError) {
            setFieldError(commentError);
            setReview(false);
          } else setError(result.error.message);
        } else {
          setSelected(null);
          setNotice(
            `${request.publicNo}: ${staffActions[to].label} — сохранено.`,
          );
          router.refresh();
        }
      } catch {
        setError("Не удалось сохранить действие. Попробуйте снова.");
      }
    });
  }
  function choose(request: StaffQueueCardDto, to: StaffTarget) {
    if (pending || !request.actions.includes(to)) return;
    setNotice("");
    setError("");
    setFieldError("");
    if (to === "needs_info" || to === "rejected") {
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setComment("");
      setCommentCode("");
      setReview(false);
      setSelected({ request, to });
    } else send(request, to);
  }
  const feedback = (
    <>
      <p
        role="status"
        aria-live="polite"
        className="text-sm text-muted-foreground empty:hidden"
      >
        {pending ? "Сохраняем действие…" : notice}
      </p>
      {error && !selected && (
        <p role="alert" className="text-sm text-destructive">
          {error} Повторите действие кнопкой заявки.
        </p>
      )}
    </>
  );
  const dialog = (
    <Sheet
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open && !pending) setSelected(null);
      }}
    >
      <SheetContent
        showCloseButton={!pending}
        className="mx-auto w-full max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          opener.current?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle>
            {selected ? staffActions[selected.to].label : "Действие по заявке"}
          </SheetTitle>
          <SheetDescription>
            {selected?.request.publicNo} · {selected?.request.type.title}.
            Комментарий получит студент.
          </SheetDescription>
        </SheetHeader>
        {selected && (
          <form
            className="space-y-4 px-4 pb-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (!comment.trim()) {
                setFieldError("Добавьте комментарий.");
                setReview(false);
                return;
              }
              if (comment.trim().length > 2000) {
                setFieldError("Не больше 2000 символов.");
                setReview(false);
                return;
              }
              if (review) send(selected.request, selected.to, comment);
              else {
                setFieldError("");
                setReview(true);
              }
            }}
          >
            {review ? (
              <div className="space-y-3">
                <h2 className="font-semibold">
                  Проверьте комментарий перед отправкой
                </h2>
                <p className="whitespace-pre-wrap break-words rounded-feature border bg-secondary p-4">
                  {comment.trim()}
                </p>
              </div>
            ) : (
              <>
                <label className="block text-sm" htmlFor={`${id}-template`}>
                  Шаблон комментария
                </label>
                <select
                  id={`${id}-template`}
                  className="min-h-11 w-full min-w-0 rounded-lg border bg-background p-3"
                  value={demoCommentsOnly ? commentCode : ""}
                  onChange={(event) => {
                    const option = staffCommentOptions[selected.to].find(
                      (option) => option.code === event.target.value,
                    );
                    setComment(option?.label ?? "");
                    setCommentCode(option?.code ?? "");
                    setFieldError("");
                  }}
                >
                  <option value="">
                    {demoCommentsOnly
                      ? "Выберите комментарий из списка"
                      : "Выберите и при необходимости измените"}
                  </option>
                  {staffCommentOptions[selected.to].map((option, index) => (
                    <option key={option.code} value={option.code}>
                      {index + 1}. {option.label}
                    </option>
                  ))}
                </select>
                <label className="block text-sm" htmlFor={`${id}-comment`}>
                  Комментарий (обязательно)
                </label>
                <textarea
                  id={`${id}-comment`}
                  rows={4}
                  maxLength={2000}
                  readOnly={demoCommentsOnly}
                  aria-required="true"
                  aria-invalid={!!fieldError}
                  aria-describedby={fieldError ? `${id}-error` : undefined}
                  value={comment}
                  onChange={(event) => {
                    setComment(event.target.value);
                    setFieldError("");
                  }}
                  className="w-full rounded-lg border bg-background p-3"
                />
                {demoCommentsOnly && (
                  <p className="text-sm text-muted-foreground">
                    В демо-аккаунте студент получает только выбранный
                    комментарий.
                  </p>
                )}
                {fieldError && (
                  <p
                    id={`${id}-error`}
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {fieldError}
                  </p>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-3 [overflow-wrap:normal]">
              <Button type="submit" disabled={pending}>
                {pending
                  ? "Отправляем…"
                  : review
                    ? "Подтвердить отправку"
                    : "Проверить комментарий"}
              </Button>
              {review && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setReview(false)}
                >
                  Изменить комментарий
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setSelected(null)}
              >
                Отмена
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
  return { choose, pending, feedback, dialog };
}
