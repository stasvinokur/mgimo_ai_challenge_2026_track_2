import type { UIMessage } from "ai";
import type { AssistantEvent } from "@/application/assistant/ports";

export type AssistantMessage = UIMessage<
  unknown,
  { assistant: Exclude<AssistantEvent, { type: "text" }> }
>;
