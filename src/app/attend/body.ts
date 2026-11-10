import { ValidationError } from "@/application/shared/errors";

const limit = 1024;
const invalid = () =>
  new ValidationError({
    input: ["Проверьте действие отметки и повторите запрос."],
  });

function cancel(
  body: ReadableStream<Uint8Array> | ReadableStreamDefaultReader<Uint8Array>,
) {
  void body.cancel().catch(() => console.warn("ATTENDANCE_BODY_CANCEL_FAILED"));
}

export async function readAttendanceBody(
  request: Request,
  timeoutMs = 5000,
): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > limit) {
    if (request.body) cancel(request.body);
    throw invalid();
  }
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(invalid()), timeoutMs);
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), expired]);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) throw invalid();
      body += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } catch {
    cancel(reader);
    throw invalid();
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
