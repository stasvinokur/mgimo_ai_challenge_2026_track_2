import { expect, it } from "vitest";
import { loginScriptsFromHtml, loginScriptUrl } from "../e2e/login-chunks";

it("находит скрипты и preload именно ответившего сервера без локальной сборки", () => {
  const origin = "https://example.invalid";
  expect(
    loginScriptsFromHtml(
      `
    <script src="/_next/static/one.js?a=1&amp;b=2"></script>
    <script async src='https://example.invalid/_next/static/two.js'></script>
    <link rel="preload" href="/_next/static/three.js" as="script" />
    <script src="/_next/static/two.js"></script>
    <link href="/_next/static/style.css" rel="stylesheet" />
    <script src="https://other.invalid/_next/static/foreign.js"></script>
  `,
      origin,
    ),
  ).toEqual([
    `${origin}/_next/static/one.js?a=1&b=2`,
    `${origin}/_next/static/two.js`,
    `${origin}/_next/static/three.js`,
  ]);
});

it.each([
  "javascript:alert(1)",
  "http://[invalid",
  "/api/private.js",
  "/_next/static/image.png",
])("отбрасывает неподходящий адрес, вариант %#", (url) => {
  expect(loginScriptUrl(url, "https://example.invalid")).toBeNull();
});
