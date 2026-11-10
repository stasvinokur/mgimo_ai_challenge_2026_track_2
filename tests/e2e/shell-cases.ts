export const conceptNotice =
  "Конкурсный концепт MGIMO×AI Challenge. Не официальный сервис МГИМО. Все данные вымышлены";

export const shellPages = [
  {
    path: "/today",
    title: "Сегодня",
    empty: null,
  },
  // Implemented sections set empty: null; their own specs check the content.
  { path: "/schedule", title: "Расписание", empty: null },
  { path: "/grades", title: "Учёба", empty: null },
  { path: "/requests", title: "Заявки", empty: null },
  { path: "/notifications", title: "Уведомления", empty: null },
  {
    path: "/profile",
    title: "Профиль",
    empty: "Данные студента",
  },
  { path: "/staff/requests", title: "Заявки студентов", empty: null },
] as const;

import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

export async function assistantAnswer(text: string) {
  const response = createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute({ writer }) {
        writer.write({ type: "start", messageId: crypto.randomUUID() });
        writer.write({ type: "text-start", id: "answer" });
        writer.write({ type: "text-delta", id: "answer", delta: text });
        writer.write({ type: "text-end", id: "answer" });
        writer.write({ type: "finish" });
      },
    }),
  });
  return {
    status: 200,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  };
}
