import { expect, it, vi } from "vitest";
import { readAssistantBody } from "@/app/api/assistant/body";
import { ValidationError } from "@/application/shared/errors";

it("ограничивает байты потока до разбора JSON, даже без Content-Length", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(16001));
    },
    cancel,
  });
  const request = new Request("http://localhost/api/assistant", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
  await expect(readAssistantBody(request)).rejects.toThrow(ValidationError);
  expect(cancel).toHaveBeenCalledOnce();
});
it("считает байты UTF-8, сохраняет корректный текст", async () => {
  const text = JSON.stringify({ question: "Справка для работодателя" });
  expect(
    await readAssistantBody(
      new Request("http://localhost", { method: "POST", body: text }),
    ),
  ).toBe(text);
  await expect(
    readAssistantBody(
      new Request("http://localhost", {
        method: "POST",
        body: "я".repeat(8001),
      }),
    ),
  ).rejects.toThrow(ValidationError);
});
it("прекращает незавершённое тело по общему таймауту", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ cancel });
  await expect(
    readAssistantBody(
      new Request("http://localhost", {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit),
      10,
    ),
  ).rejects.toThrow(ValidationError);
  expect(cancel).toHaveBeenCalledOnce();
});
