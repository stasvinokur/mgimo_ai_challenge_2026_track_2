import { expect, it } from "vitest";
import { precacheURLs } from "../e2e/pwa-precache";

it("извлекает все URL именно из precache собранного JS, включая скобки и экранирование", () => {
  const source =
    'new Serwist({precacheEntries:[{url:"/_next/a].js",revision:null},{"url":"/icons/a\\u002eb.png",revision:"x"},{url:"/offline.html",revision:"y"}]}); const other={url:"/api/not-precache"};';
  expect(precacheURLs(source)).toEqual([
    "/_next/a].js",
    "/icons/a.b.png",
    "/offline.html",
  ]);
});
it.each([
  "const x = {};",
  "new Serwist({precacheEntries:[]})",
  "new Serwist({precacheEntries:[{url:unknown}]})",
  'new Serwist({precacheEntries:[{url:"https://other.example"}]})',
])("не пропускает неизвестный или пустой precache: %s", (source) => {
  expect(() => precacheURLs(source)).toThrow();
});
it("разрешает вынесенный esbuild массив из верхнего уровня, не исполняя код", () => {
  expect(
    precacheURLs(
      'var m=[{url:"/offline.html",revision:"x"}]; function other(){var m=[{url:"/other"}];} new Serwist({precacheEntries:m});',
    ),
  ).toEqual(["/offline.html"]);
});
