import assert from "node:assert/strict";
import { demoAccounts } from "@/application/identity/demo-accounts";
import { loginMessages } from "@/ui/i18n/dictionaries/login";
import { loginScriptsFromHtml } from "../e2e/login-chunks";

const origin = `http://localhost:${process.env.PORT || "3000"}`;
const enabled = process.env.DEMO_LOGIN_HINTS !== "off";
let passed = 0;
const chunks = new Set<string>();
for (const language of ["ru", "en"] as const) {
  for (const rsc of [false, true]) {
    const response = await fetch(`${origin}/login`, {
      headers: {
        Cookie: `pulse-language=${language}`,
        Origin: origin,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": rsc ? "cors" : "navigate",
        "Sec-Fetch-Dest": rsc ? "empty" : "document",
        ...(rsc ? { RSC: "1" } : {}),
      },
    });
    assert.equal(response.status, 200);
    assert(
      response.headers
        .get("content-type")
        ?.includes(rsc ? "text/x-component" : "text/html"),
    );
    assert(response.headers.get("cache-control")?.includes("no-store"));
    const body = await response.text();
    for (const account of demoAccounts)
      assert.equal(body.includes(account.password), enabled);
    assert.equal(
      body.includes(language === "ru" ? "Войти как" : "Sign in as"),
      enabled && !rsc,
    );
    assert.equal(
      body.includes(loginMessages.demoHint[language]),
      enabled && !rsc,
    );
    if (!rsc) {
      for (const url of loginScriptsFromHtml(body, origin)) chunks.add(url);
      assert(body.includes(loginMessages.passkey[language]));
      assert(
        body.includes(
          language === "ru" ? "Все данные вымышлены" : "All data is fictional",
        ),
      );
      assert(
        body.includes(language === "ru" ? "Переключить тему" : "Switch theme"),
      );
    }
    passed++;
  }
}
assert(chunks.size > 0);
for (const url of chunks) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert(!body.includes("demo-2026"), "Пароль найден в JS-чанке.");
  for (const account of demoAccounts)
    assert(!body.includes(account.password), "Пароль найден в JS-чанке.");
  passed++;
}
console.info(
  `Вход: ${passed}/${passed} HTTP-проверок; режим ${enabled ? "on" : "off"}, JS-чанков страницы: ${chunks.size}.`,
);
