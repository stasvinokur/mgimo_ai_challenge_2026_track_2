import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { SearchDto } from "@/application/search/dto";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { CommandPalette } from "@/ui/search/command-palette";
import { Highlight } from "@/ui/search/highlight";
import { SearchForm, SearchPending } from "@/ui/search/search-form";
import { SearchView } from "@/ui/search/search-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

it("поиск без JS не имеет потоковой loading-границы", () => {
  for (const directory of [
    "src/app",
    "src/app/(student)",
    "src/app/(student)/search",
  ]) {
    for (const extension of ["tsx", "ts", "jsx", "js"])
      expect(existsSync(resolve(directory, `loading.${extension}`))).toBe(
        false,
      );
  }
});

it.each([false, true])(
  "форма compact=%s отдаёт обычный GET без скрытого ожидания",
  (compact) => {
    const html = renderToStaticMarkup(
      createElement(
        SearchForm,
        { compact },
        createElement("input", {
          type: "search",
          name: "q",
          defaultValue: "география",
        }),
      ),
    );
    expect(html).toContain('action="/search"');
    expect(html).toContain('method="get"');
    expect(html).toContain('name="q"');
    expect(html).not.toContain("aria-busy");
    expect(html).not.toContain("Ищем по кабинету");
  },
);

it("клиентский скелетон содержит статус вне занятой формы", () => {
  const html = renderToStaticMarkup(createElement(SearchPending));
  expect(html).toContain('role="status"');
  expect(html).toContain("Ищем по кабинету…");
  expect(html.match(/data-slot="skeleton"/g)).toHaveLength(2);
});

it("HTML остаётся текстом, подсветка совпадений и FTS не создаёт исполняемую разметку", () => {
  for (const marked of [false, true]) {
    const html = renderToStaticMarkup(
      createElement(Highlight, {
        text: marked
          ? "[[[<script>alert(1)</script>]]]"
          : "<script>alert(1)</script>",
        query: "script",
        marked,
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;");
    expect(html).toContain("<mark");
    expect(html).not.toContain("[[[");
  }
});

it("ошибка группы с повтором и сохранёнными результатами не выдаётся за пустой поиск", () => {
  const result: SearchDto = {
    query: "справка",
    groups: [
      {
        id: "requests",
        status: "partial",
        more: 2,
        items: [
          {
            id: "one",
            title: "Справка",
            context: { code: "requestType", description: "Описание из БД" },
            href: "/requests/new?type=enrollment",
          },
        ],
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(SearchView, { query: result.query, result }),
  );
  expect(html).toContain("Часть результатов временно недоступна");
  expect(html).toContain("Повторить поиск");
  expect(html).toContain("И ещё 2");
  expect(html).toContain('href="/requests/new?type=enrollment"');
  expect(html).not.toContain("Ничего не найдено");
});

it("триггер палитры без JS остаётся ссылкой на поиск", () => {
  const html = renderToStaticMarkup(createElement(CommandPalette));
  expect(html).toContain('href="/search?q="');
  expect(html).toContain("Поиск по кабинету");
  expect(html).not.toContain('role="dialog"');
  expect(html).not.toContain("data-palette-ready");
});

it.each(["ru", "en"] as const)(
  "словарь поиска переводит группы, статусы и ошибки: %s",
  (language) => {
    const result: SearchDto = {
      query: "география",
      groups: [
        { id: "schedule", status: "error", more: 0, items: [] },
        {
          id: "grades",
          status: "ok",
          more: 0,
          items: [
            {
              id: "course",
              title: "География",
              context: { code: "course" },
              href: "/grades/course",
            },
          ],
        },
        {
          id: "requests",
          status: "partial",
          more: 2,
          items: [
            {
              id: "request",
              title: {
                code: "request",
                publicNo: null,
                typeTitle: "Справка об обучении",
              },
              context: { code: "request", status: "ready" },
              href: "/requests/request",
            },
          ],
        },
        { id: "regulations", status: "ok", more: 0, items: [] },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(SearchView, { language, query: result.query, result }),
    );
    for (const label of language === "en"
      ? [
          "Search your portal",
          "Schedule",
          "Studies",
          "Requests",
          "Regulations",
          "Could not load this group.",
          "Some results are temporarily unavailable.",
          "Retry search",
          "Draft · Справка об обучении",
          "Your request · Ready",
          "Course · assessments and grades",
          "2 more.",
        ]
      : [
          "Поиск по кабинету",
          "Расписание",
          "Учёба",
          "Заявки",
          "Положения",
          "Не удалось загрузить эту группу.",
          "Часть результатов временно недоступна.",
          "Повторить поиск",
          "Черновик · Справка об обучении",
          "Своя заявка · Готова",
          "Дисциплина · работы и оценки",
          "И ещё 2.",
        ])
      expect(html).toContain(label);
    expect(html).toContain("География");
    expect(html).not.toContain("overflow-wrap:anywhere");
    expect(html).toContain("[word-break:normal]");
  },
);

it.each(["controlCharacters", "queryLength"] as const)(
  "English: валидация %s переводится по закрытому коду",
  (validation) => {
    const html = renderToStaticMarkup(
      createElement(SearchView, { language: "en", query: "а", validation }),
    );
    expect(html).toContain(
      validation === "controlCharacters"
        ? "Remove control characters from your query."
        : "Enter a query of 2–80 characters.",
    );
    expect(html).toContain('role="alert"');
  },
);

it("English: клиентские скелетон, пустота и триггер используют язык провайдера", () => {
  function render(child: ReturnType<typeof createElement>) {
    const props = { language: "en" as const, children: child };
    return renderToStaticMarkup(createElement(LanguageProvider, props));
  }
  const pending = render(createElement(SearchPending));
  expect(pending).toContain("Loading search");
  expect(pending).toContain("Searching your portal…");
  const empty = render(
    createElement(SearchView, {
      language: "en",
      query: "щщщзз",
      result: { query: "щщщзз", groups: [] },
    }),
  );
  expect(empty).toContain("No results found");
  expect(empty).toContain("Ask the assistant");
  const initial = render(
    createElement(SearchView, { language: "en", query: "" }),
  );
  expect(initial).toContain("Start with a word or number");
  const trigger = render(createElement(CommandPalette));
  expect(trigger).toContain("Search your portal");
  expect(trigger).toContain('href="/search?q="');
});
