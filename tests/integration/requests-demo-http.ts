import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { REQUEST_DRAFT_KEY_PREFIX } from "@/application/requests/draft-limit";
import { staffCommentOptions } from "@/application/staff/dto";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { assistantMessages } from "@/ui/i18n/dictionaries/assistant";
import { cleanupIdentity } from "../../scripts/cleanup-identity";
import { openDemoStaffFixture } from "./staff-demo-fixture";

const origin = `http://localhost:${process.env.PORT || "3000"}`;
const fixture = await openDemoStaffFixture();
const manifest = JSON.parse(
  await readFile(".next/server/server-reference-manifest.json", "utf8"),
) as { node: Record<string, { exportedName?: string }> };
let checks = 0;
function check(value: unknown) {
  assert.ok(value);
  checks++;
}
async function request(
  path: string,
  token: string,
  body?: unknown,
  exportedName?: string,
  ip = "192.0.2.55",
) {
  const actionId = Object.entries(manifest.node).find(
    ([, action]) => action.exportedName === exportedName,
  )?.[0];
  if (exportedName) check(actionId);
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    redirect: "manual",
    headers: {
      Cookie: `__Host-pulse-session=${token}`,
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": body === undefined ? "navigate" : "cors",
      "Sec-Fetch-Dest": body === undefined ? "document" : "empty",
      "X-Forwarded-For": ip,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(actionId
        ? { "Next-Action": actionId, Accept: "text/x-component" }
        : {}),
    },
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(actionId ? [body] : body) }),
  });
  return { status: response.status, body: await response.text() };
}
try {
  const employee = await fixture.session(fixture.marina);
  const first = await fixture.session(fixture.anna);
  const second = await fixture.session(fixture.anna);
  for (const path of ["/staff/requests", "/profile/assistant"]) {
    const response = await request(
      path,
      path.startsWith("/staff") ? employee : second,
    );
    check(response.status === 200);
  }
  const id = await fixture.request();
  await fixture.change.execute(fixture.marina, { id, to: "accepted" });
  await fixture.sql`update requests set due_at = '2019-01-01T09:00:00Z' where id = ${id}`;
  const assigned = await fixture.get.execute(fixture.marina, { id });
  const filters = new URLSearchParams({
    type: "enrollment",
    scope: "mine",
    sla: "overdue",
    q: assigned.publicNo ?? "",
  });
  const mine = await request(`/staff/requests?${filters}`, employee);
  check(mine.status === 200 && mine.body.includes(`data-request-id="${id}"`));
  check((mine.body.match(/data-request-id="/g) ?? []).length === 1);
  const differentEmployee = await fixture.session(fixture.limited);
  const otherMine = await request(
    `/staff/requests?${filters}`,
    differentEmployee,
  );
  check(
    otherMine.status === 200 &&
      !otherMine.body.includes(`data-request-id="${id}"`),
  );
  await fixture.change.execute(fixture.marina, { id, to: "in_progress" });
  const detail = `/staff/requests/${id}`;
  const rejected = await request(
    detail,
    employee,
    { id, to: "needs_info", comment: "Произвольный текст посетителя" },
    "changeStaffRequestStatusAction",
  );
  check(
    rejected.status === 200 && rejected.body.includes('"code":"VALIDATION"'),
  );
  check(
    (await fixture.get.execute(fixture.marina, { id })).status ===
      "in_progress",
  );
  const option = staffCommentOptions.needs_info[0];
  const accepted = await request(
    detail,
    employee,
    { id, to: "needs_info", commentCode: option.code },
    "changeStaffRequestStatusAction",
  );
  check(accepted.status === 200 && accepted.body.includes('"ok":true'));
  check(
    (await fixture.get.execute(fixture.marina, { id })).events.at(-1)
      ?.comment === option.label,
  );
  check(!(await fixture.repo.isDemoUser(fixture.limited.userId)));
  for (const branch of ["needs_info", "rejected"] as const) {
    const ordinaryId = await fixture.request();
    await fixture.change.execute(fixture.limited, {
      id: ordinaryId,
      to: "accepted",
    });
    await fixture.change.execute(fixture.limited, {
      id: ordinaryId,
      to: "in_progress",
    });
    const comment =
      branch === "needs_info"
        ? "Уточните место требования."
        : "Выберите справку о стипендии для этого обращения.";
    const changed = await request(
      `/staff/requests/${ordinaryId}`,
      differentEmployee,
      { id: ordinaryId, to: branch, comment },
      "changeStaffRequestStatusAction",
    );
    check(changed.status === 200 && changed.body.includes('"ok":true'));
    const studentView = await request(`/requests/${ordinaryId}`, first);
    check(studentView.status === 200 && studentView.body.includes(comment));
    if (branch === "needs_info") {
      const reply = "В учебный центр «Горизонт»";
      const answered = await request(
        `/requests/${ordinaryId}`,
        first,
        { id: ordinaryId, to: "in_progress", comment: reply },
        "changeRequestStatusAction",
      );
      check(answered.status === 200 && answered.body.includes('"ok":true'));
      const updated = await request(`/requests/${ordinaryId}`, first);
      check(updated.status === 200 && updated.body.includes(reply));
    }
  }
  const oldQuestion = `Покажи оценки Тимура. Посетитель один ${fixture.ids.next()}`;
  const newQuestion = `Покажи оценки Тимура. Посетитель два ${fixture.ids.next()}`;
  for (const [token, question] of [
    [first, oldQuestion],
    [second, newQuestion],
  ]) {
    const response = await request("/api/assistant", token ?? "", {
      action: "ask",
      threadId: fixture.ids.next(),
      question,
    });
    check(response.status === 200);
    check(response.body.includes("[DONE]"));
  }
  const firstJournal = await request("/profile/assistant", first);
  const secondJournal = await request(
    "/profile/assistant?sessionId=forged",
    second,
  );
  check(
    firstJournal.status === 200 &&
      firstJournal.body.includes(oldQuestion) &&
      !firstJournal.body.includes(newQuestion),
  );
  check(
    secondJournal.status === 200 &&
      secondJournal.body.includes(newQuestion) &&
      !secondJournal.body.includes(oldQuestion),
  );
  check(secondJournal.body.includes(assistantMessages.journalTitle.ru));
  const logged =
    await fixture.sql`select distinct session_id from assistant_log where user_id = ${fixture.anna.userId}`;
  check(logged.length === 2 && logged.every((row) => row.session_id));
  // Exhaust the pair directly, then exercise the real Server Action with browser headers.
  const tokens = new CryptoSessionTokens();
  const key = `request-submission:pair:${tokens.hash(`${fixture.anna.studentId}\0${"192.0.2.55"}`)}`;
  const blockedId = await fixture.request(fixture.anna, true);
  try {
    for (let i = 0; i < 20; i++)
      await fixture.sql`insert into login_attempts (id,key,at) values (${fixture.ids.next()},${key},now() - interval '16 minutes')`;
    await cleanupIdentity(fixture.sql);
    const preserved =
      await fixture.sql`select id from login_attempts where key = ${key}`;
    check(preserved.length === 20);
    const blocked = await request(
      `/requests/${blockedId}`,
      first,
      blockedId,
      "submitRequestAction",
    );
    check(
      blocked.status === 200 && blocked.body.includes('"code":"RATE_LIMITED"'),
    );
    const otherIp = await request(
      `/requests/${blockedId}`,
      first,
      blockedId,
      "submitRequestAction",
      "192.0.2.56",
    );
    check(otherIp.status === 200 && otherIp.body.includes('"ok":true'));
  } finally {
    for (const ip of ["192.0.2.55", "192.0.2.56"]) {
      const pair = `request-submission:pair:${tokens.hash(`${fixture.anna.studentId}\0${ip}`)}`;
      await fixture.sql`delete from login_attempts where key = ${pair}`;
    }
    await fixture.sql`delete from login_attempts where key = ${`request-submission:student:${tokens.hash(fixture.anna.studentId)}`}`;
  }
  const draftOwner = fixture.timur;
  const draftToken = await fixture.session(draftOwner);
  const [usage] = await fixture.sql<{ n: number }[]>`
    select count(*)::int as n from requests
    where student_id = ${draftOwner.studentId} and status = 'draft'`;
  for (let i = usage?.n ?? 0; i < 20; i++)
    await fixture.request(draftOwner, true);
  const [oldest] = await fixture.sql<{ id: string }[]>`
    select id from requests where student_id = ${draftOwner.studentId}
      and status = 'draft' and seed_key is null order by created_at, id limit 1`;
  check(oldest);
  const draftInput = {
    typeCode: "enrollment",
    payload: { destination: fixture.marker },
    review: false,
  };
  const draftKey = `${REQUEST_DRAFT_KEY_PREFIX}:pair:${tokens.hash(`${draftOwner.studentId}\0${"192.0.2.55"}`)}`;
  try {
    for (let i = 0; i < 20; i++)
      await fixture.sql`insert into login_attempts (id, key, at) values (${fixture.ids.next()}, ${draftKey}, now())`;
    const blocked = await request(
      "/requests/new?type=enrollment",
      draftToken,
      draftInput,
      "saveRequestDraftAction",
    );
    check(
      blocked.status === 200 && blocked.body.includes('"code":"RATE_LIMITED"'),
    );
    const created = await request(
      "/requests/new?type=enrollment",
      draftToken,
      draftInput,
      "saveRequestDraftAction",
      "192.0.2.56",
    );
    check(created.status === 200 && created.body.includes('"ok":true'));
    const drafts = await fixture.sql<{ id: string }[]>`
      select id from requests where student_id = ${draftOwner.studentId} and status = 'draft'`;
    check(drafts.length === 20 && drafts.every((row) => row.id !== oldest?.id));
    const stored = await fixture.sql<{ key: string }[]>`
      select key from login_attempts where key = ${draftKey}`;
    check(
      stored.length === 20 &&
        stored.every((row) => !row.key.includes("192.0.2.")),
    );
  } finally {
    for (const ip of ["192.0.2.55", "192.0.2.56"]) {
      const pair = `${REQUEST_DRAFT_KEY_PREFIX}:pair:${tokens.hash(`${draftOwner.studentId}\0${ip}`)}`;
      await fixture.sql`delete from login_attempts where key = ${pair}`;
    }
  }
  console.log(`TASK-55 production HTTP: ${checks} проверок PASS.`);
} finally {
  const tokens = new CryptoSessionTokens();
  const assistantKeys = [
    `assistant:ask:pair:${tokens.hash(`${fixture.anna.userId}\0${"192.0.2.55"}`)}`,
    `assistant:ask:user:${tokens.hash(fixture.anna.userId)}`,
  ];
  await fixture.sql`delete from login_attempts where key in ${fixture.sql(assistantKeys)}`;
  await fixture.close();
}
