import { ValidationError } from "@/application/shared/errors";

const limit = 16_000;
export async function readAssistantBody(
  request: Request,
  timeoutMs = 5000,
): Promise<string> {
  const invalid = () =>
    new ValidationError({
      question: ["Напишите вопрос до 2000 символов и повторите отправку."],
    });
  if (Number(request.headers.get("content-length")) > limit) {
    void request.body?.cancel();
    throw invalid();
  }
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(invalid());
      void reader.cancel();
    }, timeoutMs);
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), expired]);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) {
        void reader.cancel();
        throw invalid();
      }
      body += decoder.decode(next.value, { stream: true });
    }
    return body + decoder.decode();
  } catch {
    throw invalid();
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
