"use client";

export const ASSISTANT_OPEN_EVENT = "pulse:open-assistant";

/** Call from a client click/submit handler; the shell owns the only conversation. */
export function openAssistant(question?: string) {
  window.dispatchEvent(
    new CustomEvent(ASSISTANT_OPEN_EVENT, { detail: { question } }),
  );
}

export function subscribeAssistantEntry(open: (question?: string) => void) {
  const listener = (event: Event) => {
    const detail: unknown = (event as CustomEvent).detail;
    if (typeof detail !== "object" || detail === null) return;
    const question = "question" in detail ? detail.question : undefined;
    if (question !== undefined && typeof question !== "string") return;
    open(question);
  };
  window.addEventListener(ASSISTANT_OPEN_EVENT, listener);
  return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, listener);
}

export function createAssistantQuestionSender({
  isBusy,
  clearError,
  send,
}: {
  isBusy: () => boolean;
  clearError: () => void;
  send: (question: string) => Promise<unknown>;
}) {
  let pending = false;
  return async (question: string) => {
    const text = question.trim();
    if (!text || text.length > 2000 || pending || isBusy()) return false;
    // React status updates arrive after two clicks can reach this handler.
    pending = true;
    try {
      clearError();
      await send(text);
      return true;
    } finally {
      pending = false;
    }
  };
}
