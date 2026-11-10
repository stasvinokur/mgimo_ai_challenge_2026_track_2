import type { ChatTransport } from "ai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantMessage } from "@/ui/assistant/message";
import { useAssistant } from "@/ui/assistant/use-assistant";

const chat = vi.hoisted(() => ({
  useChat:
    vi.fn<(options: { transport: ChatTransport<AssistantMessage> }) => void>(),
}));
vi.mock("@ai-sdk/react", () => ({ useChat: chat.useChat }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useMemo: (factory: () => unknown) => factory(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function HookProbe() {
  useAssistant();
  return null;
}

function send() {
  renderToStaticMarkup(createElement(HookProbe));
  const transport = chat.useChat.mock.lastCall?.[0].transport;
  if (!transport) throw new Error("Транспорт ассистента не создан.");
  return transport.sendMessages({
    trigger: "submit-message",
    chatId: "test-thread",
    messages: [],
    messageId: undefined,
    abortSignal: undefined,
  });
}

it.each([400, 401, 403, 429, 500, 503])(
  "ассистент отменяет незавершённый поток HTTP %s до сообщения об ошибке",
  async (status) => {
    let finish: () => void = () => {};
    const cancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const response = new Response(new ReadableStream({ cancel }), { status });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const settled = vi.fn();
    const result = send().then(settled, settled);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(response.bodyUsed).toBe(true);
    expect(settled).not.toHaveBeenCalled();
    finish();
    await result;
    expect(settled).toHaveBeenCalledExactlyOnceWith(new Error(String(status)));
  },
);

it.each([
  { body: '{"error":{"code":"ASSISTANT_BUSY"}}', message: "ASSISTANT_BUSY" },
  { body: '{"error":{"code":"CONFLICT"}}', message: "409" },
  { body: "не JSON", message: "409" },
])(
  "HTTP 409 дочитан, сообщение $message сохранено",
  async ({ body, message }) => {
    let sent = false;
    const ended = vi.fn();
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          if (sent) {
            ended();
            controller.close();
          } else {
            sent = true;
            controller.enqueue(new TextEncoder().encode(body));
          }
        },
      }),
      { status: 409 },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(send()).rejects.toThrow(message);
    expect(response.bodyUsed).toBe(true);
    expect(ended).toHaveBeenCalledOnce();
  },
);

it("ошибка отмены потока не подменяет HTTP-ошибку ассистента", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const response = new Response(
    new ReadableStream({
      cancel() {
        throw new Error("Сбой потока");
      },
    }),
    { status: 401 },
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  await expect(send()).rejects.toThrow("401");
  expect(response.bodyUsed).toBe(true);
  expect(warn).toHaveBeenCalledExactlyOnceWith(
    "ASSISTANT_RESPONSE_CANCEL_FAILED",
  );
});
