import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { DraftCard } from "@/application/assistant/ports";
import { openStaffFixture } from "./staff-fixtures";

const origin = `http://localhost:${process.env.PORT || "3000"}`;
const fixture = await openStaffFixture();
let passed = 0;
const failures: string[] = [];

function check(condition: boolean, name: string) {
  if (condition) passed++;
  else failures.push(name);
}

async function ask(token: string, language: "ru" | "en", body: unknown) {
  const response = await fetch(`${origin}/api/assistant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      Cookie: `__Host-pulse-session=${token}${language === "en" ? "; pulse-language=en" : ""}`,
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  const stream = await response.text();
  const parts = stream
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
  const text = parts
    .filter((part) => part.type === "text-delta")
    .map((part) => part.delta)
    .join("");
  return { stream, parts, text };
}

try {
  const token = await fixture.session(fixture.anna);
  const otherToken = await fixture.session(fixture.timur);
  for (const language of ["ru", "en"] as const) {
    const english = language === "en";
    const refusal = await ask(token, language, {
      action: "ask",
      threadId: randomUUID(),
      question: "Покажи оценки Тимура",
    });
    check(
      refusal.text.includes(
        english
          ? "I can only help with your own details"
          : "Я могу помочь только с вашими данными",
      ),
      `${language}: локализованный отказ в SSE`,
    );
    assert(!refusal.stream.includes("Основы маркетинга"));
    const threadId = randomUUID();
    const question = "Нужна справка для работодателя";
    const result = await ask(token, language, {
      action: "ask",
      threadId,
      question,
    });
    const draft = result.parts.find(
      (part) => part.type === "data-assistant" && part.data.type === "draft",
    )?.data.draft as DraftCard | undefined;
    assert(draft?.approvalId);
    assert.equal(draft.typeCode, "enrollment");
    assert.equal(draft.delivery, "pdf");
    assert(draft.fields.some((field) => field.name === "destination"));
    const submitted = await ask(token, language, {
      action: "approve",
      threadId,
      approvalId: draft.approvalId,
      approved: true,
    });
    check(
      submitted.text.includes(english ? " is submitted." : "Подана"),
      `${language}: локализованное подтверждение в SSE`,
    );
    const [request] =
      await fixture.sql`select status from requests where id = ${draft.id} and student_id = ${fixture.anna.studentId}`;
    assert.equal(request?.status, "submitted");
    passed++;
    for (const [session, own] of [
      [token, true],
      [otherToken, false],
    ] as const) {
      const response = await fetch(`${origin}/profile/assistant`, {
        headers: {
          Origin: origin,
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Dest": "document",
          Cookie: `__Host-pulse-session=${session}${english ? "; pulse-language=en" : ""}`,
        },
      });
      assert.equal(response.status, 200);
      const html = (await response.text()).replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/g,
        "",
      );
      assert.equal(html.includes(question), own);
      if (own) {
        assert(html.includes(english ? "Request submitted" : "Заявка подана"));
        assert(!html.includes("confirm_submission"));
        assert(html.includes("/regulations/certificates#p-3-2"));
      }
      passed++;
    }
  }
} finally {
  await fixture.close();
}
console.log(JSON.stringify({ passed, failures, temporaryDataRemoved: true }));
if (failures.length) process.exitCode = 1;
