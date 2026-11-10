"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AssistantChatPanel } from "@/ui/assistant/chat";
import { useAssistant } from "@/ui/assistant/use-assistant";
import { shellMessages } from "@/ui/i18n/dictionaries/shell";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/ui/primitives/sheet";
import type { RequestProfileAction } from "@/ui/requests/profile-fields";
import {
  createAssistantQuestionSender,
  subscribeAssistantEntry,
} from "./assistant-entry";

export function AssistantSheet({
  requestProfileAction,
}: {
  requestProfileAction?: RequestProfileAction;
}) {
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  const chat = useAssistant();
  const latestChat = useRef(chat);
  latestChat.current = chat;
  const isOpen = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const ask = useMemo(
    () =>
      createAssistantQuestionSender({
        isBusy: () =>
          latestChat.current.status === "submitted" ||
          latestChat.current.status === "streaming",
        clearError: () => latestChat.current.clearError(),
        send: (question) => latestChat.current.sendMessage({ text: question }),
      }),
    [],
  );
  useEffect(
    () =>
      subscribeAssistantEntry((question) => {
        if (!isOpen.current) {
          returnFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }
        isOpen.current = true;
        setOpen(true);
        if (question)
          void ask(question).catch(() =>
            console.warn("ASSISTANT_ENTRY_SEND_FAILED"),
          );
      }),
    [ask],
  );
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        isOpen.current = value;
        setOpen(value);
      }}
    >
      <SheetTrigger asChild>
        <Button
          className="assistant-trigger"
          onClick={() => {
            returnFocus.current = null;
          }}
        >
          <span className="assistant-symbol" aria-hidden="true">
            ✦
          </span>
          <span className="sr-only md:not-sr-only">
            {t(language, shellMessages, "assistant")}
          </span>
        </Button>
      </SheetTrigger>
      <SheetContent
        closeLabel={t(language, shellMessages, "close")}
        className="assistant-sheet max-sm:h-svh max-sm:max-h-svh max-sm:rounded-none sm:h-[85svh]"
        onCloseAutoFocus={(event) => {
          const target = returnFocus.current;
          returnFocus.current = null;
          if (target?.isConnected) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <SheetHeader className="shrink-0">
          <span className="assistant-emblem" aria-hidden="true">
            ✦
          </span>
          <div>
            <SheetTitle>{t(language, shellMessages, "assistant")}</SheetTitle>
            <SheetDescription>
              {t(language, shellMessages, "assistantDescription")}
            </SheetDescription>
          </div>
        </SheetHeader>
        <AssistantChatPanel
          chat={chat}
          requestProfileAction={requestProfileAction}
          close={() => {
            isOpen.current = false;
            setOpen(false);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
