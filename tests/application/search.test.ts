import { expect, it, vi } from "vitest";
import { isInternalSearchHref } from "@/application/search/links";
import { parseSearchInput } from "@/application/search/schemas";
import { SEARCH_GROUP_LIMIT } from "@/application/search/search-cabinet";
import { ForbiddenError, ValidationError } from "@/application/shared/errors";
import { change, staff } from "../fakes/schedule";
import { searchFixture } from "../fakes/search";

it.each([
  [
    "ГЕОГРАФИЯ",
    "schedule",
    "Политическая география",
    "/schedule?view=week&week=2026-W45",
  ],
  [
    "артем демин",
    "schedule",
    "Политическая география",
    "/schedule?view=week&week=2026-W45",
  ],
  [
    "демо-102",
    "schedule",
    "Политическая география",
    "/schedule?view=week&week=2026-W45",
  ],
  ["география", "grades", "Политическая география", "/grades/course-anna"],
  ["эссе", "grades", "Эссе о регионах", "/grades/course-anna"],
  [
    "000002",
    "requests",
    {
      code: "request",
      publicNo: "З-2026-000002",
      typeTitle: "Справка об обучении",
    },
    "/requests/request-anna",
  ],
  [
    "справка",
    "requests",
    "Справка об обучении",
    "/requests/new?type=enrollment",
  ],
])("источник %s → %s", async (q, id, title, href) => {
  const d = searchFixture();
  const result = await d.search.execute(d.anna, { q });
  expect(result.groups.find((group) => group.id === id)?.items).toContainEqual(
    expect.objectContaining({ title, href }),
  );
  expect(d.logs).toEqual([]);
});

it("положения используют нормализованный FTS-запрос, якорь и маркеры без HTML", async () => {
  const d = searchFixture();
  d.regulations.matches = [
    {
      slug: "academic-leave",
      documentTitle: "Академотпуск",
      section: "3.2",
      title: "Как подать заявление",
      excerpt: "Срок [[[академотпуска]]]",
    },
  ];
  const result = await d.search.execute(d.anna, { q: "  АКАДЕМОТПУСК  " });
  expect(d.regulations.calls).toEqual(["академотпуск"]);
  expect(result.groups[3]?.items[0]).toMatchObject({
    href: "/regulations/academic-leave#p-3-2",
    markedContext: true,
  });
  expect(result.query).toBe("АКАДЕМОТПУСК");
});

it("чужой номер и дисциплина не дают результатов; все приватные вызовы с владельцем", async () => {
  const d = searchFixture();
  const schedule = vi.spyOn(d.schedule, "findForStudent");
  const requests = vi.spyOn(d.requests, "listForStudent");
  for (const q of ["000999", "Основы маркетинга"])
    expect(
      (await d.search.execute(d.anna, { q })).groups.every(
        (group) => group.items.length === 0,
      ),
    ).toBe(true);
  expect(schedule.mock.calls).toEqual([["anna"], ["anna"]]);
  expect(requests.mock.calls).toEqual([["anna"], ["anna"]]);
  expect(d.grades.calls).toEqual([
    { studentId: "anna" },
    { studentId: "anna" },
  ]);
});

it.each(["", " ", "а", "  а  ", "а".repeat(81), null, 5, ["география"]])(
  "невалидная длина/форма %j отклонена до I/O",
  async (q) => {
    const d = searchFixture();
    const schedule = vi.spyOn(d.schedule, "findForStudent");
    await expect(d.search.execute(d.anna, { q })).rejects.toThrow(
      ValidationError,
    );
    expect(schedule).not.toHaveBeenCalled();
    expect(d.regulations.calls).toEqual([]);
  },
);

it.each(["аа", "а".repeat(80), "  ЁЖ  "])(
  "граница длины %j допустима после trim",
  async (q) => {
    const d = searchFixture();
    await expect(d.search.execute(d.anna, { q })).resolves.toHaveProperty(
      "query",
      q.trim(),
    );
  },
);

it.each([
  "\u0000\u0000",
  "гео\u0000графия",
  "\tгеография",
  "география\n",
  "география\r\n",
  "гео\u007fграфия",
  "гео\u0085графия",
  "\u009fгеография",
])("управляющие символы %j отклонены до trim, I/O и логирования", async (q) => {
  const d = searchFixture();
  const schedule = vi.spyOn(d.schedule, "findForStudent");
  const requests = vi.spyOn(d.requests, "listForStudent");
  const catalog = vi.spyOn(d.requests, "listTypes");
  await expect(d.search.execute(d.anna, { q })).rejects.toThrow(
    ValidationError,
  );
  expect(schedule).not.toHaveBeenCalled();
  expect(requests).not.toHaveBeenCalled();
  expect(catalog).not.toHaveBeenCalled();
  expect(d.grades.calls).toEqual([]);
  expect(d.regulations.calls).toEqual([]);
  expect(d.logs).toEqual([]);
});

it("идентификаторы из источников не превращают ссылки результатов во внешние", async () => {
  const d = searchFixture();
  const course = d.record.courses[0];
  if (!course) throw new Error("Нет тестовой дисциплины.");
  course.id = "//example.test/\\?\u0000";
  d.request.id = "//example.test/\\?\u007f";
  d.regulations.matches = [
    {
      slug: "//example.test/\\?\u0085",
      documentTitle: "География",
      section: "1.1",
      title: "География",
      excerpt: "География",
    },
  ];
  for (const q of ["география", "справка"]) {
    const result = await d.search.execute(d.anna, { q });
    const items = result.groups.flatMap((group) => group.items);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(isInternalSearchHref(item.href)).toBe(true);
      expect(new URL(item.href, "https://pulse.example").origin).toBe(
        "https://pulse.example",
      );
    }
  }
  expect(d.logs).toEqual([]);
});

it.each(["studentId", "userId", "faculty"])(
  "use case не принимает дополнительный %s",
  async (field) => {
    const d = searchFixture();
    await expect(
      d.search.execute(d.anna, { q: "география", [field]: "timur" }),
    ).rejects.toThrow(ValidationError);
    expect(d.grades.calls).toEqual([]);
  },
);

it("сотрудник отклонён до валидации и чтения", async () => {
  const d = searchFixture();
  await expect(d.search.execute(staff, {})).rejects.toThrow(ForbiddenError);
  expect(d.grades.calls).toEqual([]);
  expect(d.regulations.calls).toEqual([]);
});

it("лимит каждой группы в application и точный остаток среди полученных совпадений", async () => {
  const d = searchFixture();
  const count = SEARCH_GROUP_LIMIT + 4;
  const template = d.schedule.records.get("anna")?.slots[0];
  if (!template) throw new Error("Нет тестовой пары.");
  d.schedule.records.set("anna", {
    group: "ДЕМО",
    changes: [],
    slots: Array.from({ length: count }, (_, i) => ({
      ...template,
      id: `slot-${i}`,
      course: "Поиск",
    })),
  });
  d.record.courses = Array.from({ length: count }, (_, i) => ({
    id: `course-${i}`,
    title: "Поиск",
    works: [],
    exams: [],
  }));
  d.requests.records = Array.from({ length: count }, (_, i) => ({
    ...d.request,
    id: `request-${i}`,
    publicNo: `Поиск-${i}`,
  }));
  d.regulations.matches = Array.from({ length: count }, (_, i) => ({
    slug: "search",
    documentTitle: "Поиск",
    title: "Поиск",
    section: `${i + 1}`,
    excerpt: "Поиск",
  }));
  for (const group of (await d.search.execute(d.anna, { q: "поиск" })).groups) {
    expect(group.items).toHaveLength(SEARCH_GROUP_LIMIT);
    expect(group.more).toBe(4);
  }
});

it.each(["schedule", "grades", "requests", "catalog", "regulations"] as const)(
  "сбой %s не скрывает доступные группы; лог без запроса и Error.message",
  async (source) => {
    const d = searchFixture();
    const fail = () => {
      throw new Error("секретный запрос: справка");
    };
    if (source === "schedule")
      vi.spyOn(d.schedule, "findForStudent").mockImplementation(fail);
    if (source === "grades")
      vi.spyOn(d.grades, "listForStudent").mockImplementation(fail);
    if (source === "requests")
      vi.spyOn(d.requests, "listForStudent").mockImplementation(fail);
    if (source === "catalog")
      vi.spyOn(d.requests, "listTypes").mockImplementation(fail);
    if (source === "regulations")
      vi.spyOn(d.regulations, "search").mockImplementation(fail);
    const result = await d.search.execute(d.anna, { q: "справка" });
    expect(result.groups.map((group) => group.status)).toEqual([
      source === "schedule" ? "error" : "ok",
      source === "grades" ? "error" : "ok",
      ["requests", "catalog"].includes(source) ? "partial" : "ok",
      source === "regulations" ? "error" : "ok",
    ]);
    expect(d.logs).toEqual([
      {
        event: "search_source_unavailable",
        context: { code: `SEARCH_${source.toUpperCase()}_UNAVAILABLE` },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("секретный");
    if (source === "requests")
      expect(result.groups[2]?.items[0]?.href).toBe(
        "/requests/new?type=enrollment",
      );
    if (source === "catalog")
      expect(
        (await d.search.execute(d.anna, { q: "000002" })).groups[2]?.items[0]
          ?.href,
      ).toBe("/requests/request-anna");
  },
);

it("все пять чтений стартуют до завершения первого", async () => {
  const d = searchFixture();
  const { promise, resolve } = Promise.withResolvers<null>();
  vi.spyOn(d.schedule, "findForStudent").mockReturnValue(promise);
  const requests = vi.spyOn(d.requests, "listForStudent");
  const catalog = vi.spyOn(d.requests, "listTypes");
  const pending = d.search.execute(d.anna, { q: "справка" });
  expect(d.grades.calls).toHaveLength(1);
  expect(requests).toHaveBeenCalledOnce();
  expect(catalog).toHaveBeenCalledOnce();
  expect(d.regulations.calls).toHaveLength(1);
  resolve(null);
  await pending;
});

it("текущая московская неделя, замена аудитории и преподавателя учитываются", async () => {
  const d = searchFixture();
  const data = d.schedule.records.get("anna");
  if (!data) throw new Error("Нет расписания.");
  data.changes = [
    change({
      kind: "replaced",
      newRoom: "ЁЖ-200",
      newTeacher: "Ёлкин",
      newDate: null,
    }),
  ];
  const result = await d.search.execute(d.anna, { q: "еж-200" });
  expect(result.groups[0]?.items[0]?.context).toMatchObject({
    code: "schedule",
    teacher: "Ёлкин",
    room: "ЁЖ-200",
  });
  d.clock.set("2026-11-08T21:05:00Z");
  expect(
    (await d.search.execute(d.anna, { q: "география" })).groups[0]?.items[0]
      ?.href,
  ).toContain("2026-W46");
  expect(
    (await d.search.execute(d.anna, { q: "еж-200" })).groups[0]?.items,
  ).toEqual([]);
});

it("сворачивает внутренние пробелы, показывает совпадение в длинном описании каталога", async () => {
  const d = searchFixture();
  const type = d.requests.types[0];
  if (!type) throw new Error("Нет типа.");
  type.description = `${"Сведения ".repeat(40)}учёт   документов ${"заявки ".repeat(40)}`;
  const item = (await d.search.execute(d.anna, { q: " УЧЕТ документов " }))
    .groups[2]?.items[0];
  expect(item?.context.code).toBe("requestType");
  if (item?.context.code !== "requestType")
    throw new Error("Нет результата каталога.");
  expect(item.context.description).toContain("учёт   документов");
  expect(item.context.description.length).toBeLessThan(200);
});

it("черновики ищутся по типу, технический номер draft не отображается и не ищется", async () => {
  const d = searchFixture();
  d.requests.records = [
    { ...d.request, status: "draft", publicNo: "draft:internal-id" },
  ];
  const result = await d.search.execute(d.anna, { q: "справка" });
  expect(result.groups[2]?.items[0]?.title).toEqual({
    code: "request",
    publicNo: null,
    typeTitle: "Справка об обучении",
  });
  expect(result.groups[2]?.items[0]?.context).toEqual({
    code: "request",
    status: "draft",
  });
  expect(JSON.stringify(result)).not.toContain("internal-id");
  expect(
    (await d.search.execute(d.anna, { q: "internal-id" })).groups[2]?.items,
  ).toEqual([]);
});

it("пустые источники дают пустые группы, два сбоя заявки дают error", async () => {
  const d = searchFixture();
  d.schedule.records.clear();
  d.grades.records.clear();
  d.requests.records = [];
  d.requests.types = [];
  const result = await d.search.execute(d.anna, { q: "ёлка" });
  expect(
    result.groups.every(
      (group) =>
        group.status === "ok" && group.items.length === 0 && group.more === 0,
    ),
  ).toBe(true);
  vi.spyOn(d.requests, "listTypes").mockRejectedValue(new Error("failed"));
  vi.spyOn(d.requests, "listForStudent").mockRejectedValue(new Error("failed"));
  expect(
    (await d.search.execute(d.anna, { q: "ёлка" })).groups[2]?.status,
  ).toBe("error");
});

it("DTO сохраняет данные и UTC, а подписи групп и состояний заменяет кодами", async () => {
  const d = searchFixture();
  d.regulations.matches = [
    {
      slug: "academic-leave",
      documentTitle: "Положение об отпуске",
      title: "Условия отпуска",
      section: "3.2",
      excerpt: "Срок [[[отпуска]]]",
    },
  ];
  const courseResult = await d.search.execute(d.anna, { q: "география" });
  expect(courseResult.groups.map((group) => group.id)).toEqual([
    "schedule",
    "grades",
    "requests",
    "regulations",
  ]);
  expect(courseResult.groups.every((group) => !("title" in group))).toBe(true);
  expect(courseResult.groups[0]?.items[0]).toMatchObject({
    title: "Политическая география",
    context: {
      code: "schedule",
      startsAt: "2026-11-02T06:00:00.000Z",
      teacher: "Артём Дёмин",
      room: "ДЕМО-102",
      status: "scheduled",
    },
  });
  expect(courseResult.groups[1]?.items[0]?.context).toEqual({ code: "course" });
  expect(courseResult.groups[3]?.items[0]?.context).toEqual({
    code: "regulation",
    documentTitle: "Положение об отпуске",
    section: "3.2",
    excerpt: "Срок [[[отпуска]]]",
  });
  const workResult = await d.search.execute(d.anna, { q: "эссе" });
  expect(workResult.groups[1]?.items[0]?.context).toEqual({
    code: "work",
    course: "Политическая география",
    score: 78,
    maxScore: 100,
    dueAt: "2026-11-04T21:30:00.000Z",
  });
  const requestResult = await d.search.execute(d.anna, { q: "справка" });
  expect(requestResult.groups[2]?.items[0]?.context).toEqual({
    code: "request",
    status: "ready",
  });
  expect(requestResult.groups[2]?.items[1]?.context).toMatchObject({
    code: "requestType",
    description: d.requests.types[0]?.description,
  });
  const serialized = JSON.stringify([courseResult, workResult, requestResult]);
  for (const label of [
    "Расписание",
    "Дисциплина · работы и оценки",
    "Своя заявка",
    "Подать заявку",
    "Готова",
    "ауд.",
  ])
    expect(serialized).not.toContain(label);
});

it.each([
  ["\nгеография", "controlCharacters"],
  ["гео\u0085графия", "controlCharacters"],
  ["а", "queryLength"],
  ["а".repeat(81), "queryLength"],
  [null, "queryLength"],
] as const)("валидация %j отдаёт закрытый код %s без фразы", (q, code) => {
  try {
    parseSearchInput({ q });
    expect.fail("Ожидалась ошибка валидации.");
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    if (!(error instanceof ValidationError)) throw error;
    expect(error.fieldErrors).toEqual({ q: [code] });
  }
});
