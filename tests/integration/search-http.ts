import assert from "node:assert/strict";
import { createDatabase } from "@/infrastructure/db/client";
import { readDemoAccountCounts } from "./demo-account-counts";
import { searchRequestsForStudent } from "./search-data";
import { openStaffFixture } from "./staff-fixtures";

const origin = `http://127.0.0.1:${process.env.PORT || "3000"}`;
const sql = createDatabase(1);
const before = await readDemoAccountCounts(sql);
const f = await openStaffFixture();
let passed = 0;
const failures: string[] = [];
let staffHtmlStatus = 0;
let staffRscStatus = 0;
let staffRscRedirect = false;

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
) {
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

try {
  const anna = await f.session(f.anna);
  const timur = await f.session(f.timur);
  const staff = await f.session(f.limited);
  await f.request(f.timur);
  const own = (await searchRequestsForStudent(f.anna.studentId))[0];
  const foreign = (await searchRequestsForStudent(f.timur.studentId))[0];
  assert(own && foreign);
  for (const [q, content] of [
    ["", "Начните со слова или номера"],
    ["география", "Политическая"],
    ["ДЕМО-102", "ауд."],
    ["академ", "Подать заявку"],
    ["академотпуск", "/regulations/academic-leave#p-"],
    ["ёлка", "Ничего не найдено"],
    ["а", "Введите запрос от 2 до 80 символов."],
    ["а".repeat(81), "Введите запрос от 2 до 80 символов."],
    [own.publicNo.slice(-8), `/requests/${own.id}`],
    ["эссе", "из 100"],
    ["справка об обучении", "/requests/new?type=enrollment"],
  ] as const) {
    await check(`поиск-${passed + failures.length + 1}`, async () => {
      const { response, text } = await get(
        `/search?${new URLSearchParams({ q })}`,
        anna,
      );
      assert.equal(response.status, 200);
      assert(text.includes(content));
      assert(!text.includes("search_source_unavailable"));
      assert(!text.includes('aria-label="Загрузка поиска"'));
      assert(!text.includes("Ищем по кабинету…"));
      const forms =
        text.match(
          /<form(?=[^>]*action="\/search")(?=[^>]*method="get")[^>]*>/g,
        ) ?? [];
      assert.equal(forms.length, 1);
      assert(forms.every((form) => !form.includes("aria-busy")));
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    });
  }
  const foreignQueries = [
    foreign.publicNo,
    foreign.publicNo.slice(-8),
    "Основы маркетинга",
  ];
  for (const q of foreignQueries) {
    await check("изоляция-поиска", async () => {
      const { text } = await get(
        `/search?${new URLSearchParams({ q, studentId: f.timur.studentId, userId: f.timur.userId, faculty: f.timur.facultyId })}`,
        anna,
      );
      assert(text.includes("Ничего не найдено"));
      assert(!text.includes(`href="/requests/${foreign.id}"`));
    });
  }
  for (const q of foreignQueries) {
    await check("свои-результаты-тимура", async () => {
      const { response, text } = await get(
        `/search?${new URLSearchParams({ q })}`,
        timur,
      );
      assert.equal(response.status, 200);
      assert(!text.includes("Ничего не найдено"));
      if (q === "Основы маркетинга") {
        const group =
          /<section aria-labelledby="search-grades">([\s\S]*?)<\/section>/.exec(
            text,
          )?.[1];
        assert(group);
        assert(group.includes("Основы маркетинга"));
        assert.match(group, /href="\/grades\/[0-9a-f-]{36}"/);
      } else {
        assert(text.includes(`href="/requests/${foreign.id}"`));
      }
    });
  }
  await check("аноним-вход", async () => {
    const { response } = await get("/search?q=география");
    assert.equal(response.status, 307);
    assert(response.headers.get("location")?.includes("/login"));
  });
  await check("сотрудник-редирект-html", async () => {
    const { response, text } = await get("/search?q=география", staff);
    staffHtmlStatus = response.status;
    assertStaffRedirect(response, text);
  });
  await check("сотрудник-без-входа-в-поиск", async () => {
    const { text } = await get("/staff/requests", staff);
    assert(!text.includes('action="/search"'));
    assert(!text.includes('href="/search?q="'));
  });
  await check("подмена-владельца-rsc", async () => {
    const { text } = await get(
      `/search?${new URLSearchParams({ q: foreign.publicNo, studentId: f.timur.studentId, userId: f.timur.userId })}`,
      anna,
      {
        RSC: "1",
        "Next-Router-State-Tree": encodeURIComponent(
          JSON.stringify([
            "",
            {
              children: [
                "(student)",
                {
                  children: [
                    "search",
                    { children: ["__PAGE__", {}, null, "refetch"] },
                  ],
                },
              ],
            },
          ]),
        ),
      },
    );
    assert(text.includes("Ничего не найдено"));
    assert(!text.includes(`/requests/${foreign.id}`));
  });
  await check("сотрудник-редирект-rsc", async () => {
    const { response, text } = await get("/search?q=география", staff, {
      RSC: "1",
      "Next-Router-State-Tree": encodeURIComponent(
        JSON.stringify([
          "",
          {
            children: [
              "(student)",
              {
                children: [
                  "search",
                  { children: ["__PAGE__", {}, null, "refetch"] },
                ],
              },
            ],
          },
        ]),
      ),
    });
    staffRscStatus = response.status;
    assertStaffRedirect(response, text, true);
    staffRscRedirect = true;
  });
  for (const path of [
    "/today",
    "/schedule",
    "/grades",
    "/requests",
    "/notifications",
    "/profile",
    "/regulations",
  ]) {
    await check("вход-в-оболочке", async () => {
      const { response, text } = await get(path, anna);
      assert.equal(response.status, 200);
      assert(text.includes('href="/search?q="'));
    });
  }
  await check("ссылки-результатов", async () => {
    const { text } = await get("/search?q=география", anna);
    const targets = [
      ...text.matchAll(
        /href="(\/(?:schedule\?view=week[^"<]+|grades\/[^"<]+))"/g,
      ),
    ].map((match) => match[1]?.replaceAll("&amp;", "&"));
    assert(targets.length >= 2);
    for (const path of targets) {
      assert(path);
      assert.equal((await get(path, anna)).response.status, 200);
    }
    assert.equal((await get(`/requests/${own.id}`, anna)).response.status, 200);
    assert.equal(
      (await get("/regulations/academic-leave", anna)).response.status,
      200,
    );
  });
} finally {
  await f.close();
  const after = await readDemoAccountCounts(sql);
  await sql.end({ timeout: 1 });
  assert.deepEqual(after, before);
}
console.log(
  JSON.stringify({
    passed,
    failures,
    staffHtmlStatus,
    staffRscStatus,
    staffRscRedirect,
    demoCountsUnchanged: true,
  }),
);
if (failures.length) process.exitCode = 1;

function assertStaffRedirect(response: Response, text: string, rsc = false) {
  if (rsc && response.status === 200) {
    assert.equal(response.status, 200);
    assert(response.headers.get("content-type")?.includes("text/x-component"));
    assert(text.includes("NEXT_REDIRECT;replace;/staff/requests;307;"));
  } else {
    assert.equal(response.status, 307);
    const destination = new URL(response.headers.get("location") ?? "", origin);
    assert.equal(destination.origin, origin);
    assert.equal(destination.pathname, "/staff/requests");
  }
  assert(!text.includes("Политическая география"));
  assert(!text.includes("Результаты поиска"));
  assert(!text.includes("search-schedule"));
  assert(!text.includes(f.anna.studentId));
  assert(!text.includes(f.timur.studentId));
  assert(!/Анна Соколова|Тимур Белов|З-\d{4}-\d{6}/.test(text));
}
