import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { DraftCard } from "@/application/assistant/ports";
import { PostgresAssistantJournal } from "@/infrastructure/db/repositories/assistant/journal";
import { readDemoAccountCounts } from "./demo-account-counts";
import { openStaffFixture } from "./staff-fixtures";

const origin = `http://127.0.0.1:${process.env.PORT || "3000"}`;
const f = await openStaffFixture();
const before = await readDemoAccountCounts(f.sql);
const journal = new PostgresAssistantJournal(
  () => f.sql,
  { now: () => new Date() },
  f.ids,
);
const tree = encodeURIComponent(
  JSON.stringify([
    "",
    {
      children: [
        "(student)",
        {
          children: [
            "profile",
            {
              children: [
                "assistant",
                { children: ["__PAGE__", {}, null, "refetch"] },
              ],
            },
          ],
        },
      ],
    },
  ]),
);
let passed = 0;
const failures: string[] = [];

async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    passed++;
  } catch {
    failures.push(name);
  }
}

async function get(
  path: string,
  token?: string,
  extra: Record<string, string> = {},
  canonical = false,
): Promise<{ response: Response; text: string }> {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    headers: {
      Accept: "text/html",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Dest": "document",
      ...(token ? { Cookie: `__Host-pulse-session=${token}` } : {}),
      ...extra,
    },
  });
  const text = await response.text();
  const location = response.headers.get("location");
  if (extra.RSC && !canonical && response.status === 307 && location) {
    const destination = new URL(location, origin);
    if (
      destination.origin === origin &&
      destination.pathname === new URL(path, origin).pathname &&
      destination.searchParams.has("_rsc")
    )
      return get(
        `${destination.pathname}${destination.search}`,
        token,
        extra,
        true,
      );
  }
  return { response, text };
}

async function ask(token: string, data: unknown) {
  const response = await fetch(`${origin}/api/assistant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      Cookie: `__Host-pulse-session=${token}`,
    },
    body: JSON.stringify(data),
  });
  const text = await response.text();
  assert.equal(response.status, 200);
  return text;
}

try {
  const anna = await f.session(f.anna),
    timur = await f.session(f.timur),
    staff = await f.session(f.limited);
  await check("аноним", async () => {
    const { response } = await get("/profile/assistant");
    assert.equal(response.status, 307);
    assert(response.headers.get("location")?.includes("/login"));
  });
  await check("пустой-журнал", async () => {
    const { response, text } = await get("/profile/assistant", anna);
    assert.equal(response.status, 200);
    for (const content of [
      "Мой журнал ассистента",
      "Пока нет записей",
      "Спросить ассистента",
      "Записи хранятся 14 дней",
      "ИИ не отправляет заявки без вашего подтверждения",
    ])
      assert(text.includes(content));
    assert(response.headers.get("cache-control")?.includes("no-store"));
  });
  await check("ссылка-из-профиля", async () => {
    const { text } = await get("/profile", anna);
    assert(text.includes('href="/profile/assistant"'));
  });
  const question = "Нужна справка для работодателя";
  for (const approved of [true, false]) {
    await check(
      approved ? "вопрос-черновик-подтверждение" : "вопрос-черновик-отказ",
      async () => {
        const threadId = randomUUID();
        const stream = await ask(anna, { action: "ask", threadId, question });
        const draft = stream
          .split("\n")
          .filter((line) => line.startsWith("data: {"))
          .map((line) => JSON.parse(line.slice(6)))
          .find(
            (part) =>
              part.type === "data-assistant" && part.data.type === "draft",
          )?.data.draft as DraftCard | undefined;
        assert(draft?.approvalId);
        await ask(anna, {
          action: "approve",
          threadId,
          approvalId: draft.approvalId,
          approved,
        });
        const { text } = await get("/profile/assistant", anna);
        for (const content of [
          question,
          "Подготовил черновик",
          "/regulations/certificates#p-3-2",
          approved ? "Заявка подана" : "Не отправлено, черновик сохранён",
        ])
          assert(text.includes(content));
        assert.match(
          text,
          approved
            ? /<dt[^>]*>Ваше действие<\/dt><dd[^>]*>Подтвердить отправку<\/dd>/
            : /<dt[^>]*>Ваше действие<\/dt><dd[^>]*>Не отправлять<\/dd>/,
        );
        if (approved) assert(text.includes('href="/requests"'));
        const [log] =
          await f.sql`select outcome from assistant_log where user_id = ${f.anna.userId} order by at desc, id desc limit 1`;
        assert.equal(log?.outcome, approved ? "submitted" : "declined");
      },
    );
  }
  await check("ошибка-отправки-показана-как-failed", async () => {
    const threadId = randomUUID();
    const stream = await ask(anna, { action: "ask", threadId, question });
    const draft = stream
      .split("\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)))
      .find(
        (part) => part.type === "data-assistant" && part.data.type === "draft",
      )?.data.draft as DraftCard | undefined;
    assert(draft?.approvalId);
    await f.sql`update requests set updated_at = updated_at + interval '1 second' where id = ${draft.id} and student_id = ${f.anna.studentId}`;
    await ask(anna, {
      action: "approve",
      threadId,
      approvalId: draft.approvalId,
      approved: true,
    });
    const [log] =
      await f.sql`select outcome from assistant_log where user_id = ${f.anna.userId} order by at desc, id desc limit 1`;
    assert.equal(log?.outcome, "failed");
    const { text } = await get("/profile/assistant", anna);
    assert(text.includes("Не удалось выполнить"));
    assert(text.includes("Отправка не выполнена — проверьте «Мои заявки»"));
    assert(text.includes('href="/requests"'));
  });
  const foreign = `FOREIGN_QUESTION_${randomUUID()}`,
    service = `SERVICE_${randomUUID()}`,
    old = `OLD_QUESTION_${randomUUID()}`;
  await journal.append({
    userId: f.timur.userId,
    question: foreign,
    tools: [],
    sources: [],
    outcome: "answered",
  });
  await journal.append({
    userId: f.anna.userId,
    question: old,
    tools: [],
    sources: [],
    outcome: "answered",
  });
  await f.sql`update assistant_log set at = now() - interval '15 days' where user_id = ${f.anna.userId} and question = ${old}`;
  await f.sql`update assistant_log set tool_calls = ${JSON.stringify([{ systemPrompt: service }])}::text::jsonb where user_id = ${f.anna.userId}`;
  for (const rsc of [false, true]) {
    for (const forged of [false, true]) {
      await check(
        `изоляция-${rsc ? "rsc" : "html"}-${forged ? "подмена" : "обычная"}`,
        async () => {
          const { response, text } = await get(
            `/profile/assistant${forged ? `?userId=${f.timur.userId}&studentId=${f.timur.studentId}` : ""}`,
            anna,
            rsc ? { RSC: "1", "Next-Router-State-Tree": tree } : {},
          );
          assert.equal(response.status, 200);
          assert(text.includes(question));
          for (const hidden of [foreign, service, old])
            assert(!text.includes(hidden));
        },
      );
    }
    await check(`сотрудник-${rsc ? "rsc" : "html"}`, async () => {
      const { response, text } = await get(
        "/profile/assistant",
        staff,
        rsc ? { RSC: "1", "Next-Router-State-Tree": tree } : {},
      );
      assert(
        response.status === 307 ||
          (response.status === 200 &&
            text.includes("NEXT_REDIRECT;replace;/staff/requests;307;")),
      );
      if (response.status === 307)
        assert(response.headers.get("location")?.includes("/staff/requests"));
      else
        assert(
          response.headers.get("content-type")?.includes("text/x-component"),
        );
      assert(!text.includes(question));
      assert(!text.includes("Последние обращения"));
      assert(!text.includes("Пока нет записей"));
    });
  }
  await check("чужой-журнал-доступен-только-владельцу", async () => {
    const { text } = await get("/profile/assistant", timur);
    assert(text.includes(foreign));
    assert(!text.includes(question));
  });
  await check(
    "текст-вопроса-не-считается-решением-html-экранирован",
    async () => {
      const literal = '<img src=x onerror="window.JOURNAL_XSS=true">';
      await journal.append({
        userId: f.anna.userId,
        question: literal,
        sources: ["javascript:alert(1)"],
        tools: [],
        outcome: "answered",
      });
      await journal.append({
        userId: f.anna.userId,
        question: "Не отправлять",
        sources: [],
        tools: [],
        outcome: "drafted",
      });
      const { text } = await get("/profile/assistant", anna);
      assert(text.includes("&lt;img src=x"));
      assert(!text.includes(literal));
      assert(!text.includes('href="javascript:'));
      assert.match(
        text,
        /<dt[^>]*>Ваш вопрос<\/dt><dd[^>]*>Не отправлять<\/dd>/,
      );
      assert(text.includes("МСК"));
      assert(text.includes('tabindex="0"'));
    },
  );
} finally {
  await f.sql`delete from assistant_log where user_id in (${f.anna.userId}, ${f.timur.userId})`;
  assert.deepEqual(await readDemoAccountCounts(f.sql), before);
  await f.close();
}
console.log(JSON.stringify({ passed, failures, demoCountsUnchanged: true }));
if (failures.length) process.exitCode = 1;
