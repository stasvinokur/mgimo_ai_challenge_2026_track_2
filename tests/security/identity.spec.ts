import { createDatabase } from "../../src/infrastructure/db/client";
import { expect, test } from "./login";

test("демо-кнопки только подставляют поля и не создают cookie", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  for (const [name, login] of [
    ["Анна", "anna"],
    ["Тимур", "timur"],
    ["Марина", "marina"],
    ["Олег", "oleg"],
  ]) {
    await page.getByRole("button", { name: `Войти как ${name}` }).click();
    await expect(page.getByLabel("Логин", { exact: true })).toHaveValue(
      login ?? "",
    );
    await expect(page).toHaveURL(/\/login$/);
    expect(
      (await context.cookies()).some(
        (cookie) => cookie.name === "__Host-pulse-session",
      ),
    ).toBe(false);
  }
});

for (const path of ["/today", "/profile", "/staff/requests"]) {
  test(`аноним на ${path} перенаправляется на вход`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(
      new RegExp(`/login\\?next=${encodeURIComponent(path)}`),
    );
    await expect(
      page.getByRole("heading", { name: "Вход в «Пульс»" }),
    ).toBeVisible();
  });
}

test("студент на staff получает 403, включая прямой переход", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  for (const path of ["/staff", "/staff/requests", "/staff/profile"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(403);
    await expect(
      page.getByRole("heading", { name: "Доступ ограничен" }),
    ).toBeVisible();
  }
});

test("сотрудник видит свой профиль и перенаправляется со студенческих страниц", async ({
  page,
  loginAs,
}) => {
  await loginAs("marina");
  await page.goto("/today");
  await expect(page).toHaveURL(/\/staff\/requests$/);
  await page.getByRole("link", { name: "Мой профиль", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Марина Петровна Ладова");
  await expect(page.getByRole("main")).toContainText("Факультеты");
  await expect(page.getByRole("main")).not.toContainText("Номер зачётки");
});

test("профили различаются; подмена URL и query не раскрывает данные другого студента", async ({
  page,
  loginAs,
}) => {
  await loginAs("timur");
  await page.goto("/profile");
  const timurBook = await page
    .locator("dl > div")
    .filter({ has: page.getByText("Номер зачётки", { exact: true }) })
    .locator("dd")
    .textContent();
  expect(timurBook).toBeTruthy();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await loginAs("anna");
  await page.goto("/profile?studentId=timur&userId=timur");
  await expect(page.getByRole("main")).toContainText("Анна Соколова");
  await expect(page.getByRole("main")).not.toContainText("Тимур Белов");
  await expect(page.getByRole("main")).not.toContainText(
    timurBook ?? "DEMO-0002",
  );
  // Profiles have no id-bearing URL or API; those paths must stay absent.
  for (const path of ["/profile/timur", "/api/profile/timur"]) {
    const response = await page.request.get(path);
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain("Тимур Белов");
  }
});

test("cookie имеет нужные атрибуты; после выхода старая cookie больше не работает", async ({
  page,
  context,
  loginAs,
}) => {
  await loginAs("anna");
  const cookie = (await context.cookies()).find(
    (item) => item.name === "__Host-pulse-session",
  );
  expect(cookie).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
  });
  expect((cookie?.expires ?? 0) - Date.now() / 1000).toBeGreaterThan(
    6.9 * 24 * 3600,
  );
  await page.goto("/profile");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    (await context.cookies()).some(
      (item) => item.name === "__Host-pulse-session",
    ),
  ).toBe(false);
  const response = await page.request.get("/profile", {
    headers: { cookie: `__Host-pulse-session=${cookie?.value}` },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toContain("/login");
});

test("CSP nonce и заголовки безопасности есть на входе, закрытом и неизвестном маршруте", async ({
  page,
}) => {
  const policies: string[] = [];
  for (const path of [
    "/login",
    "/today",
    "/missing-security-page",
    "/icons/xyz",
    "/favicon.svg/xyz",
  ]) {
    const response = await page.goto(path);
    const headers = response?.headers() ?? {};
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toBe(
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    );
    const policy = headers["content-security-policy"] ?? "";
    expect(policy).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9+/=]+'/);
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    policies.push(policy);
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    expect(
      await page
        .locator("script:not([src])")
        .evaluateAll((scripts) =>
          scripts.map((script) => (script as HTMLScriptElement).nonce),
        ),
    ).toEqual(expect.arrayContaining([nonce]));
  }
  expect(new Set(policies).size).toBe(policies.length);
});

test("внешний next не уводит пользователя с сайта", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna", "https://evil.example");
  await expect(page).toHaveURL(/\/today$/);
});

test("в БД нет открытых паролей или токенов", async () => {
  test.skip(
    !process.env.DATABASE_URL,
    "DATABASE_URL не задан: проверка содержимого БД пропущена.",
  );
  const sql = createDatabase(1);
  try {
    const [passwords] = await sql<
      { n: number }[]
    >`select count(*)::int as n from users where password_hash not like '$argon2id$%'`;
    const [tokens] = await sql<
      { n: number }[]
    >`select count(*)::int as n from sessions where token_hash !~ '^[a-f0-9]{64}$'`;
    expect(passwords?.n).toBe(0);
    expect(tokens?.n).toBe(0);
  } finally {
    await sql.end({ timeout: 1 });
  }
});
