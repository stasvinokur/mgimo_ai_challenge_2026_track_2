"use client";

import { appPath } from "@/ui/shared/app-path.mjs";

import "./client-schemas";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useMemo } from "react";
import type { AssistantMessage } from "./message";

export function useAssistant() {
  const transport = useMemo(
    () =>
      new DefaultChatTransport<AssistantMessage>({
        api: appPath("/api/assistant"),
        prepareSendMessagesRequest: ({ id, messages, body }) => ({
          body:
            body?.action === "approve"
              ? {
                  action: "approve",
                  threadId: id,
                  approvalId: body.approvalId,
                  approved: body.approved,
                }
              : {
                  action: "ask",
                  threadId: id,
                  question:
                    messages
                      .at(-1)
                      ?.parts.filter((part) => part.type === "text")
                      .map((part) => part.text)
                      .join("\n") ?? "",
                },
        }),
        fetch: async (url, options) => {
          const response = await fetch(url, options);
          if (response.status === 409) {
            const body = await response.json().catch(() => null);
            if (body?.error?.code === "ASSISTANT_BUSY")
              throw new Error("ASSISTANT_BUSY");
          }
          if (!response.ok) {
            if (!response.bodyUsed)
              await response.body?.cancel().catch(() => {
                console.warn("ASSISTANT_RESPONSE_CANCEL_FAILED");
              });
            throw new Error(String(response.status));
          }
          return response;
        },
      }),
    [],
  );
  return useChat<AssistantMessage>({
    id: useMemo(() => crypto.randomUUID(), []),
    transport,
  });
}
export type AssistantChat = ReturnType<typeof useAssistant>;
