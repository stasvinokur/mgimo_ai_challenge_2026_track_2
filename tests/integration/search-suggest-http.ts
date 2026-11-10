import assert from "node:assert/strict";
import type { SearchDto } from "@/application/search/dto";
import { createDatabase } from "@/infrastructure/db/client";
import { readDemoAccountCounts } from "./demo-account-counts";
import { createSearchRequest } from "./search-data";
import { openStaffFixture } from "./staff-fixtures";
import { openTeacherTestData } from "./teacher-e2e-data";

const origin = `http://127.0.0.1:${process.env.PORT || "3000"}`;
const sql = createDatabase(1);
const before = await readDemoAccountCounts(sql);
const f = await openStaffFixture();
const teacher = await openTeacherTestData();
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
  html = false,
  rsc = false,
  canonical = false,
  site = "same-origin",
): Promise<{ response: Response; text: string }> {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    headers: {
      Accept: html ? "text/html" : "application/json",
      Origin: origin,
      "Sec-Fetch-Site": site,
      "Sec-Fetch-Mode": html ? "navigate" : "cors",
      "Sec-Fetch-Dest": html ? "document" : "empty",
      ...(token ? { Cookie: `__Host-pulse-session=${token}` } : {}),
      ...(rsc
        ? {
            RSC: "1",
            "Next-Router-State-Tree": encodeURIComponent(
              JSON.stringify(["", { children: ["(student)", {}] }]),
            ),
          }
        : {}),
    },
  });
  const text = await response.text();
  assert(response.headers.get("cache-control")?.includes("no-store"));
  const location = response.headers.get("location");
  if (rsc && !canonical && response.status === 307 && location) {
    const destination = new URL(location, origin);
    if (
      destination.pathname === new URL(path, origin).pathname &&
      destination.searchParams.has("_rsc")
    ) {
      assert.equal(destination.origin, origin);
      return get(
        `${destination.pathname}${destination.search}`,
        token,
        html,
        rsc,
        true,
        site,
      );
    }
  }
  return { response, text };
}
try {
  const anna = await f.session(f.anna);
  const timur = await f.session(f.timur);
  const staff = await f.session(f.limited);
  const teacherToken = await f.session(teacher.actor);
  const foreign = await createSearchRequest(f.timur.studentId);
  for (const [token, status] of [
    [undefined, 401],
    [staff, 403],
    [teacherToken, 403],
  ] as const) {
    for (const rsc of [false, true]) {
      await check(`роль-${status}-${rsc}`, async () => {
        const { response, text } = await get(
          "/api/search/suggest?q=геогр",
          token,
          false,
          rsc,
        );
        assert.equal(response.status, status);
        assert.deepEqual(Object.keys(JSON.parse(text)), ["error"]);
        assert(!text.includes("географ"));
      });
    }
  }
  for (const q of [foreign.publicNo, "Основы маркетинга"]) {
    const params = new URLSearchParams({ q });
    await check("анна-без-чужого", async () => {
      const { response, text } = await get(
        `/api/search/suggest?${params}`,
        anna,
      );
      assert.equal(response.status, 200);
      assert(
        (JSON.parse(text) as SearchDto).groups.every(
          (group) => group.items.length === 0,
        ),
      );
    });
    await check("подставленный-владелец", async () => {
      const clean = await get(`/api/search/suggest?${params}`, anna);
      const forged = await get(
        `/api/search/suggest?${params}&studentId=${f.timur.studentId}&userId=${f.timur.userId}&groupId=other`,
        anna,
      );
      assert.equal(forged.response.status, 200);
      assert.deepEqual(JSON.parse(forged.text), JSON.parse(clean.text));
    });
    await check("тимур-свои-данные", async () => {
      const { response, text } = await get(
        `/api/search/suggest?${params}`,
        timur,
      );
      assert.equal(response.status, 200);
      const result = JSON.parse(text) as SearchDto;
      assert(result.groups.some((group) => group.items.length > 0));
      if (q === foreign.publicNo)
        assert(text.includes(`/requests/${foreign.id}`));
      else
        assert(
          result.groups.some((group) =>
            group.items.some((item) => item.title === "Основы маркетинга"),
          ),
        );
    });
  }
  for (const q of ["", "а", "а".repeat(81)]) {
    await check("валидация", async () => {
      const { response } = await get(
        `/api/search/suggest?${new URLSearchParams({ q })}`,
        anna,
      );
      assert.equal(response.status, 400);
    });
  }
  for (const q of [
    "\u0000\u0000",
    "гео\u0009графия",
    "\nгеография",
    "география\u0085",
    "\t\t",
    "\n\n",
  ]) {
    await check("controls-api-400", async () => {
      const { response, text } = await get(
        `/api/search/suggest?${new URLSearchParams({ q })}`,
        anna,
      );
      assert.equal(response.status, 400);
      assert(
        JSON.parse(text).error.fieldErrors.q.includes("controlCharacters"),
      );
      assert(!text.includes("SEARCH_REGULATIONS_UNAVAILABLE"));
    });
    await check("controls-search-validation", async () => {
      const { response, text } = await get(
        `/search?${new URLSearchParams({ q })}`,
        anna,
        true,
      );
      assert.equal(response.status, 200);
      assert(text.includes("Удалите управляющие символы из запроса."));
      assert(!text.includes("search-regulations"));
    });
  }
  for (const site of ["cross-site", "same-site", "none"]) {
    await check("fetch-metadata-403", async () => {
      const { response, text } = await get(
        "/api/search/suggest?q=геогр",
        anna,
        false,
        false,
        false,
        site,
      );
      assert.equal(response.status, 403);
      assert.deepEqual(JSON.parse(text), { error: "Нет доступа." });
    });
  }
  for (const q of [
    "геогр",
    "справка",
    "академотпуск",
    "  ЁЖ  ",
    "а".repeat(80),
  ]) {
    await check("группы-и-лимит", async () => {
      const { response, text } = await get(
        `/api/search/suggest?${new URLSearchParams({ q })}`,
        anna,
      );
      assert.equal(response.status, 200);
      assert(!response.headers.has("X-Pulse-Cacheable"));
      const result = JSON.parse(text) as SearchDto;
      assert.equal(result.query, q.trim());
      assert.deepEqual(
        result.groups.map((group) => group.id),
        ["schedule", "grades", "requests", "regulations"],
      );
      assert(
        result.groups.every(
          (group) => group.items.length <= 3 && group.status === "ok",
        ),
      );
    });
  }
  for (const [token, path, trigger] of [
    [anna, "/today", true],
    [staff, "/staff/requests", false],
    [teacherToken, "/teacher", false],
  ] as const) {
    await check("триггер-по-роли", async () => {
      const { response, text } = await get(path, token, true);
      assert.equal(response.status, 200);
      assert.equal(text.includes('href="/search?q="'), trigger);
    });
  }
  await check("поиск-без-js-и-крошки", async () => {
    const { response, text } = await get("/search?q=география", anna, true);
    assert.equal(response.status, 200);
    assert(text.includes('action="/search"'));
    assert(text.includes('method="get"'));
    assert(text.includes("Политическая"));
    assert(text.includes("<span>Поиск</span>"));
    assert(!text.includes('aria-label="Загрузка поиска"'));
    assert(!text.includes("data-palette-ready"));
  });
  await check(
    "атомарный-http-лимит-20-из-30-и-изолированный-пользователь",
    async () => {
      const key = `search-suggest:${f.anna.userId}`;
      await sql`delete from login_attempts where key = ${key}`;
      const replies = await Promise.all(
        Array.from({ length: 30 }, () =>
          get("/api/search/suggest?q=геогр", anna),
        ),
      );
      assert.equal(
        replies.filter(({ response }) => response.status === 200).length,
        20,
      );
      assert.equal(
        replies.filter(({ response }) => response.status === 429).length,
        10,
      );
      for (const { response, text } of replies)
        if (response.status === 429) {
          assert.equal(JSON.parse(text).error.code, "RATE_LIMITED");
          assert(!text.includes("Политическая география"));
        }
      assert.equal(
        (await get("/api/search/suggest?q=геогр", anna)).response.status,
        429,
      );
      assert.equal(
        (await get("/api/search/suggest?q=%00%00", anna)).response.status,
        400,
      );
      assert.equal(
        (
          await get(
            "/api/search/suggest?q=геогр",
            anna,
            false,
            false,
            false,
            "cross-site",
          )
        ).response.status,
        403,
      );
      assert.equal(
        (await get("/api/search/suggest?q=геогр", timur)).response.status,
        200,
      );
    },
  );
} finally {
  const keys = [f.anna.userId, f.timur.userId].map(
    (id) => `search-suggest:${id}`,
  );
  await sql`delete from login_attempts where key = any(${keys}::text[])`;
  await f.close();
  await teacher.close();
  const after = await readDemoAccountCounts(sql);
  await sql.end({ timeout: 1 });
  assert.deepEqual(after, before);
}
console.log(JSON.stringify({ passed, failures, demoCountsUnchanged: true }));
if (failures.length) process.exitCode = 1;
