import { afterEach, expect, it, vi } from "vitest";
import { readAttendanceBody } from "@/app/attend/body";
import { ValidationError } from "@/application/shared/errors";

const address = "https://pulse.example/teacher/attendance/lesson/date/live";
const encoder = new TextEncoder();
function streamRequest(
  chunks: Uint8Array[],
  options: { length?: string; end?: boolean; cancel?: () => void } = {},
) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (options.end) controller.close();
    },
    cancel: options.cancel,
  });
  return new Request(address, {
    method: "POST",
    headers: options.length ? { "Content-Length": options.length } : undefined,
    body: stream,
    duplex: "half",
  } as RequestInit);
}
afterEach(() => vi.useRealTimers());

it("читает корректный JSON в пределах 1024 байт, включая разделённый UTF-8 символ", async () => {
  const json = JSON.stringify({ action: "issue", text: "я" });
  const bytes = encoder.encode(json);
  const position = bytes.indexOf(0xd1) + 1;
  expect(
    await readAttendanceBody(
      streamRequest([bytes.slice(0, position), bytes.slice(position)], {
        end: true,
      }),
    ),
  ).toEqual({ action: "issue", text: "я" });
  const exact = JSON.stringify({ value: "x".repeat(1012) });
  expect(encoder.encode(exact)).toHaveLength(1024);
  expect(
    await readAttendanceBody(
      new Request(address, { method: "POST", body: exact }),
    ),
  ).toEqual({ value: "x".repeat(1012) });
});
it("отсекает chunked-тело без Content-Length и отменяет поток при превышении", async () => {
  const cancel = vi.fn();
  const request = streamRequest([new Uint8Array(700), new Uint8Array(325)], {
    cancel,
  });
  await expect(readAttendanceBody(request)).rejects.toThrow(ValidationError);
  expect(cancel).toHaveBeenCalledOnce();
  expect(request.body?.locked).toBe(false);
});
it("заявленный короткий Content-Length не позволяет прочитать больше лимита", async () => {
  const cancel = vi.fn();
  await expect(
    readAttendanceBody(
      streamRequest([new Uint8Array(1025)], { length: "1", cancel }),
    ),
  ).rejects.toThrow(ValidationError);
  expect(cancel).toHaveBeenCalledOnce();
});
it("отклоняет завышенный Content-Length до получения reader и отменяет тело", async () => {
  const cancel = vi.fn();
  const request = streamRequest([], { length: "1025", cancel });
  const reader = vi.spyOn(
    request.body as ReadableStream<Uint8Array>,
    "getReader",
  );
  await expect(readAttendanceBody(request)).rejects.toThrow(ValidationError);
  expect(reader).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledOnce();
});
it("считает байты UTF-8, а не число символов", async () => {
  const json = JSON.stringify({ value: "я".repeat(512) });
  expect(json.length).toBeLessThan(1024);
  await expect(
    readAttendanceBody(new Request(address, { method: "POST", body: json })),
  ).rejects.toThrow(ValidationError);
});
it.each([
  new Uint8Array([0xff]),
  new Uint8Array([0x22, 0xd1]),
  encoder.encode("{"),
  encoder.encode(""),
])("некорректные UTF-8 или JSON возвращают ValidationError", async (bytes) => {
  await expect(
    readAttendanceBody(streamRequest([bytes], { end: true })),
  ).rejects.toThrow(ValidationError);
});
it("отклоняет отсутствующее тело", async () => {
  await expect(
    readAttendanceBody(new Request(address, { method: "POST" })),
  ).rejects.toThrow(ValidationError);
});
it("общий таймаут прерывает и отменяет незавершённый поток", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const request = streamRequest([encoder.encode('{"action":')], { cancel });
  const result = expect(readAttendanceBody(request)).rejects.toThrow(
    ValidationError,
  );
  await vi.advanceTimersByTimeAsync(5000);
  await result;
  expect(cancel).toHaveBeenCalledOnce();
  expect(request.body?.locked).toBe(false);
});
