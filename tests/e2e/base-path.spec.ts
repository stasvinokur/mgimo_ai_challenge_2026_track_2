import { randomUUID } from "node:crypto";
import {
  type BrowserContext,
  test as base,
  expect,
  type Page,
} from "@playwright/test";
import { openAttendanceTestData } from "../integration/attendance-data";
import { openCertificatesFixture } from "../integration/certificates-fixture";
import { openStudentTestData } from "../integration/student-e2e-data";
import { certificatePdfHasQrUrl } from "../unit/certificates-pdf-qr";
import { precacheURLs } from "./pwa-precache";
import { installTodayAudio } from "./today-audio";

const folder = "/dekanat";
const path = (value: string) => `${folder}${value}`;
const pagesPrefix = "pulse-pages-dekanat-v1-";

const test = base.extend<{ audit: (context: BrowserContext) => void }>({
  audit: [
    async ({ context, baseURL }, use, info) => {
      const requests: { method: string; origin: string; path: string }[] = [];
      const navigations: string[] = [];
      const pages = new Set<Page>();
      function record(url: string) {
        if (/^https?:/.test(url)) navigations.push(url);
      }
      function audit(current: BrowserContext) {
        function watch(page: Page) {
          if (pages.has(page)) return;
          pages.add(page);
          page.on("framenavigated", (frame) => record(frame.url()));
        }
        for (const page of current.pages()) watch(page);
        current.on("page", watch);
        current.on("request", (request) => {
          const url = new URL(request.url());
          if (!["http:", "https:"].includes(url.protocol)) return;
          requests.push({
            method: request.method(),
            origin: url.origin,
            path: url.pathname.replace(
              /(\/(?:calendar|attend|verify)\/)[^/]+/g,
              "$1<код>",
            ),
          });
        });
      }
      audit(context);
      const ip = randomUUID().replaceAll("-", "");
      await context.setExtraHTTPHeaders({
        "X-Forwarded-For": `2001:db8:${ip.slice(0, 4)}:${ip.slice(4, 8)}::1`,
      });
      await use(audit);
      for (const page of pages) record(page.url());
      expect(
        navigations
          .filter((value) => {
            const url = new URL(value);
            return (
              url.origin !== baseURL || !url.pathname.startsWith(`${folder}/`)
            );
          })
          .map((value) =>
            new URL(value).pathname.replace(
              /(\/(?:calendar|attend|verify)\/)[^/]+/g,
              "$1<код>",
            ),
          ),
      ).toEqual([]);
      await info.attach("Запросы браузера и service worker", {
        body: JSON.stringify(requests, null, 2),
        contentType: "application/json",
      });
      expect(requests.length).toBeGreaterThan(0);
      expect(
        requests.filter(
          (request) =>
            request.origin !== baseURL ||
            !request.path.startsWith(`${folder}/`),
        ),
      ).toEqual([]);
    },
    { auto: true },
  ],
});

test.beforeEach(() =>
  test.skip(!process.env.DATABASE_URL, "Нужна тестовая БД лейна."),
);

async function login(
  page: Page,
  credentials: { login: string; password: string },
  home = "/today",
) {
  await page.goto(path("/login"));
  await fillLogin(page, credentials);
  await expect(page).toHaveURL(new RegExp(`${folder}${home}$`));
}
async function fillLogin(
  page: Page,
  credentials: { login: string; password: string },
) {
  await page.getByLabel("Логин", { exact: true }).fill(credentials.login);
  await page.getByLabel("Пароль", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}
async function logout(page: Page) {
  const current = new URL(page.url()).pathname;
  const profile = current.startsWith(path("/staff"))
    ? "/staff/profile"
    : current.startsWith(path("/teacher"))
      ? "/teacher"
      : "/profile";
  await page.goto(path(profile));
  await expect(page).toHaveURL(new URL(path(profile), page.url()).href);
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${folder}/login$`));
}
async function controlled(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            navigator.serviceWorker.controller?.scriptURL ===
            `${location.origin}/dekanat/sw.js`,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
}
async function cached(page: Page) {
  return page.evaluate(async (prefix) => {
    const names = (await caches.keys()).filter((name) =>
      name.startsWith(prefix),
    );
    return (
      await Promise.all(
        names.map(async (name) =>
          (
            await (await caches.open(name)).keys()
          ).map((request) => new URL(request.url).pathname),
        ),
      )
    ).flat();
  }, pagesPrefix);
}

test("студент: возврат на страницу, пульс, озвучка, поиск, заявка, PDF, ICS и ассистент", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const f = await openCertificatesFixture();
  await installTodayAudio(page);
  try {
    const ready = await f.request();
    await page.goto(path("/"));
    await expect(page).toHaveURL(new RegExp(`${folder}/login\\?next=`));
    await page.goto(path("/grades"));
    await expect(page).toHaveURL(new RegExp(`${folder}/login\\?next=`));
    await fillLogin(page, f.anna.credentials);
    await expect(page).toHaveURL(new RegExp(`${folder}/grades$`));
    const pulse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path("/api/me/pulse") &&
        response.ok(),
    );
    await page.goto(path("/today"));
    await pulse;
    await expect(page.locator("[data-briefing-ready=true]")).toBeVisible();
    const audio = page.waitForRequest((request) =>
      new URL(request.url()).pathname.startsWith(path("/api/me/briefing/")),
    );
    await page.getByRole("button", { name: "Послушать", exact: true }).click();
    await audio;
    const stop = page.getByRole("button", { name: "Стоп", exact: true });
    await expect
      .poll(() => page.evaluate(() => window.todayAudio.starts))
      .toBe(1);
    await expect(stop).toBeVisible();
    await stop.click();
    const search = page.getByRole("link", { name: /Поиск по кабинету/ });
    await expect(search).toHaveAttribute("data-palette-ready", "true");
    await page.keyboard.press("Control+k");
    const suggestion = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path("/api/search/suggest"),
    );
    await page.getByRole("combobox").fill("география");
    expect((await suggestion).ok()).toBe(true);
    await page
      .getByRole("link", { name: "Открыть страницу поиска", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${folder}/search\\?q=`));
    await expect(page.getByRole("main")).toContainText(
      "Политическая география",
    );
    await page.goto(path("/schedule"));
    await page
      .getByRole("button", { name: "Получить новую ссылку", exact: true })
      .click();
    const calendar = page.getByLabel("Ссылка для подписки", { exact: true });
    await expect(calendar).toHaveValue(
      new RegExp(`^${baseURL}${folder}/api/calendar/`),
    );
    const calendarURL = await calendar.inputValue();
    const ics = await context.request.get(calendarURL);
    expect(ics.ok()).toBe(true);
    expect(await ics.text()).toContain("BEGIN:VCALENDAR");
    await expect(
      page.getByRole("link", { name: "Скачать файл .ics" }),
    ).toHaveAttribute("href", new RegExp(`^${folder}/api/calendar/`));
    await page.goto(path("/requests/new?type=enrollment"));
    await page
      .getByLabel("Место требования (обязательно)")
      .fill("Учебный центр «Папка сайта»");
    await page
      .getByRole("button", { name: "Проверить заявку", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Проверьте заявку", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Подтвердить отправку", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`${folder}/requests/[0-9a-f-]{36}$`),
    );
    await page.goto(path(`/requests/${ready.id}`));
    const download = page.getByRole("link", {
      name: "Скачать PDF",
      exact: true,
    });
    await expect(download).toHaveAttribute(
      "href",
      path(`/api/requests/${ready.id}/pdf`),
    );
    const pdf = await context.request.get(
      path(`/api/requests/${ready.id}/pdf`),
    );
    expect(pdf.status()).toBe(200);
    const verifyURL = `${baseURL}${folder}/verify/${ready.certificate?.verifyCode}`;
    expect(await certificatePdfHasQrUrl(await pdf.body(), verifyURL)).toBe(
      true,
    );
    const verification = await context.request.get(verifyURL);
    expect(verification.ok()).toBe(true);
    expect(await verification.text()).toContain(`href="${folder}/favicon.svg"`);
    await page
      .getByRole("button", { name: "Спросить или сделать", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Спросить или сделать" });
    const assistant = page.waitForResponse(
      (response) => new URL(response.url()).pathname === path("/api/assistant"),
    );
    await dialog
      .getByRole("button", {
        name: "Нужна справка для работодателя",
        exact: true,
      })
      .click();
    expect((await assistant).ok()).toBe(true);
    await expect(dialog.getByLabel("Черновик заявки")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await logout(page);
    await login(page, f.timur.credentials);
    expect((await page.goto(path(`/requests/${ready.id}`)))?.status()).toBe(
      404,
    );
    expect(
      (
        await context.request.get(path(`/api/requests/${ready.id}/pdf`))
      ).status(),
    ).toBe(404);
  } finally {
    await f.close();
  }
});

test("сотрудник: очередь, карточка своей заявки, переход статуса и выход", async ({
  page,
}) => {
  const f = await openCertificatesFixture();
  try {
    const submitted = await f.request("submitted");
    await login(page, f.staff.limitedCredentials, "/staff/requests");
    await expect(page.getByRole("main")).toContainText("Заявки");
    const redirected = await page.evaluate(async () => {
      const response = await fetch("/dekanat/grades/unused/data");
      await response.arrayBuffer();
      return new URL(response.url).pathname;
    });
    expect(redirected).toBe(path("/staff/requests"));
    await page.goto(path(`/staff/requests/${submitted.id}`));
    await expect(page.getByRole("main")).toContainText(
      "Учебная организация «Пример»",
    );
    await page.getByRole("button", { name: "Принять", exact: true }).click();
    await expect(page.getByRole("main")).toContainText("Принята");
    await logout(page);
  } finally {
    await f.close();
  }
});

test("преподаватель: QR в папке → вход студента с возвратом → отметка", async ({
  page,
  browser,
  baseURL,
  audit,
}) => {
  const f = await openAttendanceTestData({ lessonTime: "around-now" });
  const studentContext = await browser.newContext({
    baseURL,
    viewport: page.viewportSize() ?? undefined,
    serviceWorkers: "allow",
  });
  audit(studentContext);
  try {
    await login(page, f.teacher.credentials, "/teacher");
    await page.goto(path(f.path));
    await page
      .getByRole("button", { name: "Открыть отметку", exact: true })
      .click();
    const link = page.getByTestId("attendance-link");
    await expect(link).toHaveAttribute(
      "href",
      new RegExp(`^${baseURL}${folder}/attend/`),
    );
    const address = await link.getAttribute("href");
    if (!address) throw new Error("QR не выдан.");
    const student = await studentContext.newPage();
    await student.goto(address);
    await expect(student).toHaveURL(new RegExp(`${folder}/login\\?next=`));
    await fillLogin(student, f.student.credentials);
    await expect(student).toHaveURL(
      new RegExp(`${folder}/attend/[A-Za-z0-9_-]{22}$`),
    );
    await student
      .getByRole("button", { name: "Отметиться", exact: true })
      .click();
    await expect(student).toHaveURL(new RegExp(`${folder}/attend$`));
    await expect(student.getByRole("status")).toHaveText(
      "Отмечено ✓ · +1 балл активности",
    );
    await expect(
      page.getByRole("status").filter({ hasText: "Отметились" }),
    ).toHaveText("Отметились 1 из 3");
    expect((await student.reload())?.status()).toBe(200);
    await expect(student).toHaveURL(new RegExp(`${folder}/attend$`));
    await logout(page);
  } finally {
    await studentContext.close();
    await f.close();
  }
});

test("ключ доступа, Origin и cookie настроек в папке", async ({
  page,
  context,
  baseURL,
}) => {
  const f = await openStudentTestData("anna");
  const session = await context.newCDPSession(page);
  await session.send("WebAuthn.enable");
  const { authenticatorId } = await session.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  await page.addInitScript(() =>
    Object.defineProperty(
      PublicKeyCredential,
      "isConditionalMediationAvailable",
      { configurable: true, value: async () => false },
    ),
  );
  try {
    await context.addCookies([
      {
        name: "__Host-session",
        value: "neighbor-demo-session",
        domain: "localhost",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await login(page, f.credentials);
    expect(
      (await context.cookies()).find(
        (cookie) => cookie.name === "__Host-pulse-session",
      ),
    ).toMatchObject({ path: "/", secure: true, httpOnly: true });
    await context.addCookies([
      { name: "pulse-language", value: "en", domain: "localhost", path: "/" },
    ]);
    await page.goto(path("/profile"));
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    const language = page.getByLabel("Язык", { exact: true });
    await language.selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(
      (await context.cookies()).find(
        (cookie) => cookie.name === "pulse-language-dekanat",
      ),
    ).toMatchObject({ path: `${folder}/`, value: "en" });
    await page.getByLabel("Language", { exact: true }).selectOption("ru");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    const keys = page.getByRole("region", {
      name: "Ключи доступа",
      exact: true,
    });
    await keys
      .getByLabel("Название устройства", { exact: true })
      .fill("Учебный телефон");
    await keys
      .getByRole("button", { name: "Добавить ключ", exact: true })
      .click();
    await expect(
      keys.getByText("Учебный телефон", { exact: true }),
    ).toBeVisible();
    await logout(page);
    await page
      .getByRole("button", { name: "Войти с ключом доступа", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${folder}/today$`));
    const denied = await context.request.post(
      path("/api/passkeys/registration/options"),
      {
        headers: {
          Origin: "https://neighbor.example",
          "Sec-Fetch-Site": "cross-site",
        },
        data: {},
      },
    );
    expect(denied.status()).toBe(403);
    const allowed = await context.request.post(
      path("/api/passkeys/registration/options"),
      {
        headers: { Origin: baseURL ?? "", "Sec-Fetch-Site": "same-origin" },
        data: {},
      },
    );
    expect(allowed.status()).toBe(200);
    expect(
      (await context.cookies()).find(
        (cookie) => cookie.name === "__Host-passkey-registration-dekanat",
      ),
    ).toMatchObject({ path: "/", secure: true, httpOnly: true });
    await logout(page);
    expect(
      (await context.cookies()).find(
        (cookie) => cookie.name === "__Host-pulse-session",
      ),
    ).toBeUndefined();
    expect(
      (await context.cookies()).find(
        (cookie) => cookie.name === "__Host-session",
      )?.value,
    ).toBe("neighbor-demo-session");
    expect(
      (await context.cookies()).find(
        (cookie) => cookie.name === "pulse-language",
      ),
    ).toMatchObject({ value: "en", path: "/" });
  } finally {
    await session.send("WebAuthn.removeVirtualAuthenticator", {
      authenticatorId,
    });
    await session.detach();
    await f.close();
  }
});

test("переезд из корня: activate удаляет старые кэши, выход оставляет кэш соседа", async ({
  page,
  context,
}) => {
  const f = await openStudentTestData("anna");
  const legacy = ["pulse-pages-v1-old-session", "pulse-session-state-v1"];
  const neighbor = "neighbor-cache-kept";
  try {
    await page.goto(path("/login?nosw"));
    const rootPrecache = await page.evaluate(
      async ({ legacy, neighbor }) => {
        const root = `serwist-precache-v2-${location.origin}/`;
        for (const name of [
          ...legacy,
          root,
          neighbor,
          `serwist-precache-v2-${location.origin}/neighbor/`,
        ]) {
          const cache = await caches.open(name);
          await cache.put(
            `${location.origin}/dekanat/__cache_marker`,
            new Response("Учебная копия"),
          );
        }
        return root;
      },
      { legacy, neighbor },
    );
    await page.goto(path("/"));
    await expect(page).toHaveURL(new RegExp(`${folder}/login\\?next=`));
    await controlled(page);
    await expect
      .poll(() =>
        page.evaluate(
          async (names) =>
            (await caches.keys()).filter((name) => names.includes(name)),
          [...legacy, rootPrecache],
        ),
      )
      .toEqual([]);
    for (const name of [...legacy, rootPrecache])
      expect(await page.evaluate((name) => caches.has(name), name)).toBe(false);
    await fillLogin(page, f.credentials);
    await expect(page).toHaveURL(new RegExp(`${folder}/today$`));
    await expect
      .poll(() => cached(page), { timeout: 20_000 })
      .toContain(path("/today"));
    await logout(page);
    await expect.poll(() => cached(page)).toEqual([]);
    const names = await page.evaluate(() => caches.keys());
    expect(names).toContain(neighbor);
    expect(names).toContain(`${rootPrecache}neighbor/`);
    for (const name of [...legacy, rootPrecache])
      expect(names).not.toContain(name);
  } finally {
    await context.setOffline(false);
    await f.close();
  }
});

test("PWA: scope, precache 200, офлайн обеих страниц, выход и кэш соседа", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const f = await openStudentTestData("anna");
  try {
    await login(page, f.credentials);
    await controlled(page);
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.ready).scope,
      ),
    ).toBe(`${baseURL}${folder}/`);
    expect(
      await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
    ).toBe(`${baseURL}${folder}/sw.js`);
    const sw = await context.request.get(path("/sw.js"));
    expect(sw.headers()["service-worker-allowed"]).toBe(`${folder}/`);
    const urls = precacheURLs(await sw.text());
    expect(urls).toContain(path("/offline.html"));
    expect(urls).toContain(path("/manifest.webmanifest"));
    for (const url of urls) {
      expect(url.startsWith(`${folder}/`)).toBe(true);
      expect((await context.request.get(url)).status(), url).toBe(200);
    }
    const manifest = await (
      await context.request.get(path("/manifest.webmanifest"))
    ).json();
    expect(manifest).toMatchObject({
      id: `${folder}/`,
      scope: `${folder}/`,
      start_url: path("/today"),
    });
    for (const icon of manifest.icons)
      expect(icon.src.startsWith(`${folder}/icons/`)).toBe(true);
    await expect
      .poll(() => cached(page), { timeout: 20_000 })
      .toContain(path("/today"));
    await page.goto(path("/schedule"));
    await expect
      .poll(() => cached(page), { timeout: 20_000 })
      .toContain(path("/schedule"));
    await page.evaluate(async () => {
      await caches.open("pulse-pages-neighbor-v1-marker");
    });
    await context.setOffline(true);
    for (const route of ["/today", "/schedule"]) {
      await page.goto(path(route));
      await expect(page.locator("[data-pwa-offline]")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute(
        "data-pwa-saved-at",
        /.+/,
      );
    }
    await context.setOffline(false);
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-pwa-saved-at",
      /.+/,
      { timeout: 20_000 },
    );
    await logout(page);
    await expect.poll(() => cached(page)).toEqual([]);
    expect(await page.evaluate(() => caches.keys())).toContain(
      "pulse-pages-neighbor-v1-marker",
    );
    await context.setOffline(true);
    await page.goto(path("/today"));
    await expect(
      page.getByRole("heading", { name: "Пока нет сети", exact: true }),
    ).toBeVisible();
    expect(
      await page
        .getByRole("link", { name: "Сегодня", exact: true })
        .getAttribute("href"),
    ).toBe(path("/today"));
  } finally {
    await context.setOffline(false);
    await f.close();
  }
});
