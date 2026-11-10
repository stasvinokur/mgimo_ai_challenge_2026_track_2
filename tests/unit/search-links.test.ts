import { expect, it } from "vitest";
import { isInternalSearchHref } from "@/application/search/links";

it.each([
  "/",
  "/today",
  "/schedule?view=week&week=2026-W45",
  "/requests/new?type=enrollment",
  "/grades/%2F%2Fexample.test",
  "/regulations/assessment#p-4",
  "/search?q=%D0%B3%D0%B5%D0%BE%D0%B3%D1%80",
  "/search?q=https%3A%2F%2Fexample.test",
])("внутренний путь %s разрешён", (href) => {
  expect(isInternalSearchHref(href)).toBe(true);
  expect(new URL(href, "https://pulse.example").origin).toBe(
    "https://pulse.example",
  );
});

it.each([
  "",
  "today",
  " https://example.test",
  "https://example.test/",
  "http://example.test/",
  "javascript:alert(1)",
  "data:text/html,test",
  "//example.test/",
  "/\\example.test/",
  "\\\\example.test/",
  "/path\\other",
  "/\t/example.test/",
  "/\n/example.test/",
  "/\r/example.test/",
  "/path\u0000",
  "/path\u007f",
  "/path\u0085",
  undefined,
  null,
  5,
  { href: "/today" },
])("небезопасная ссылка %j отклонена", (href) => {
  expect(isInternalSearchHref(href)).toBe(false);
});
