import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { cookies } from "next/headers";
import { getActor, requireStudent } from "@/app/_lib/get-actor";
import { mapRouteError } from "@/app/_lib/map-errors";
import { AssistantBusyError } from "@/application/assistant/errors";
import { RateLimitedError, ValidationError } from "@/application/shared/errors";
import { assistant, identity } from "@/composition/container";
import type { AssistantMessage } from "@/ui/assistant/message";
import { assistantMessage } from "@/ui/assistant/presentation";
import { getLanguage } from "@/ui/i18n/server";
import { readAssistantBody } from "./body";
import { isAssistantOriginAllowed } from "./origin";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const sessionActor = await getActor();
    if (!sessionActor)
      return Response.json(
        { error: "Требуется вход." },
        { status: 401, headers },
      );
    if (sessionActor.kind !== "student")
      return Response.json({ error: "Нет доступа." }, { status: 403, headers });
    const actor = await requireStudent({ routeHandler: true });
    const language = await getLanguage();
    if (!isAssistantOriginAllowed(request, assistant.getAppOrigin()))
      return Response.json({ error: "Нет доступа." }, { status: 403, headers });
    const body = await readAssistantBody(request);
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      throw new ValidationError({ question: ["Проверьте вопрос."] });
    }
    const events = await assistant.askAssistant.execute(
      actor,
      input,
      { ip: assistant.getClientIp(request.headers.get("x-forwarded-for")) },
      (await cookies()).get(identity.sessionCookie.name)?.value,
    );
    return createUIMessageStreamResponse({
      headers,
      stream: createUIMessageStream<AssistantMessage>({
        execute: async ({ writer }) => {
          writer.write({ type: "start", messageId: crypto.randomUUID() });
          writer.write({ type: "text-start", id: "answer" });
          for await (const event of events) {
            if (event.type === "text" || event.type === "message")
              writer.write({
                type: "text-delta",
                id: "answer",
                delta:
                  event.type === "text"
                    ? event.text
                    : assistantMessage(language, event),
              });
            else
              writer.write({
                type: "data-assistant",
                id: crypto.randomUUID(),
                data: event,
              });
          }
          writer.write({ type: "text-end", id: "answer" });
          writer.write({ type: "finish" });
        },
        onError: () =>
          "Не удалось завершить ответ. Повторите попытку или откройте черновик в разделе «Заявки».",
      }),
    });
  } catch (error) {
    if (error instanceof AssistantBusyError)
      return Response.json(
        { error: { code: "ASSISTANT_BUSY", message: error.message } },
        { status: 409, headers },
      );
    if (error instanceof RateLimitedError)
      return Response.json(
        {
          error:
            "Вопросов пока достаточно. Подождите 10 минут и попробуйте снова.",
        },
        { status: 429, headers: { ...headers, "Retry-After": "600" } },
      );
    return mapRouteError(error);
  }
}
