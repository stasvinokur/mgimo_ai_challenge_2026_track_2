import AxeBuilder from "@axe-core/playwright";
import { test as base, expect } from "@playwright/test";
import {
  type EventRequestFixture,
  openEventRequestFixture,
} from "../integration/requests-event-data";
import { loginAsTestStaff } from "../security/staff-login";
import { loginAsTestStudent } from "../security/student-login";

const eventFieldTitles = [
  "Название мероприятия",
  "Организатор",
  "Дата с",
  "Дата по",
  "Формат участия",
  "Подтверждение: ссылка или текст приглашения",
];
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .formatToParts(new Date(`${value}T00:00:00Z`))
    .filter((part) => ["day", "month", "year"].includes(part.type))
    .map((part) => part.value)
    .join(" ");
}

const test = base.extend<{ eventData: EventRequestFixture }>({
  eventData: async ({ baseURL }, use) => {
    base.skip(!process.env.DATABASE_URL, "Нужна БД лейна");
    if (!baseURL) throw new Error("Укажите адрес приложения");
    const f = await openEventRequestFixture();
    try {
      await use(f);
    } finally {
      await f.close();
    }
  },
});

for (const theme of ["light", "dark"])
  test(`заявка → одобрение → excused, уведомление и баллы; axe · ${theme}`, async ({
    page,
    browser,
    eventData: f,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await loginAsTestStudent(page, f.studentCredentials.anna);
    await page.goto("/requests/new?type=event_release");
    await expect(page.locator("main form label")).toHaveText(
      eventFieldTitles.map((title) => `${title} (обязательно)`),
    );
    await expect(page.getByLabel("Дата с (обязательно)")).toHaveAttribute(
      "type",
      "date",
    );
    await expect(page.getByLabel("Дата по (обязательно)")).toHaveAttribute(
      "type",
      "date",
    );
    await page
      .getByLabel("Название мероприятия (обязательно)")
      .fill(f.payload.eventName);
    await page
      .getByLabel("Организатор (обязательно)")
      .fill(f.payload.organizer);
    await page.getByLabel("Дата с (обязательно)").fill(f.payload.dateFrom);
    await page.getByLabel("Дата по (обязательно)").fill(f.payload.dateTo);
    await page
      .getByLabel("Формат участия (обязательно)")
      .fill(f.payload.eventFormat);
    await page
      .getByLabel("Подтверждение: ссылка или текст приглашения (обязательно)")
      .fill(f.payload.confirmation);
    await page
      .getByRole("button", { name: "Проверить заявку", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Пары на время мероприятия" }),
    ).toBeVisible();
    const reviewFields = page.locator("main dl").filter({
      has: page.locator("dt").filter({ hasText: /^Название мероприятия$/ }),
    });
    await expect(reviewFields.locator("dt")).toHaveText(eventFieldTitles);
    await expect(reviewFields).toContainText(dateLabel(f.payload.dateFrom));
    await expect(reviewFields).toContainText(dateLabel(f.payload.dateTo));
    const lessons = await f.preview.execute(f.anna, {
      dateFrom: f.payload.dateFrom,
      dateTo: f.payload.dateTo,
    });
    expect(lessons.length).toBeGreaterThan(0);
    for (const lesson of lessons) {
      await expect(page.getByRole("main")).toContainText(lesson.course);
      const date = new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(lesson.startsAt));
      await expect(page.getByRole("main")).toContainText(date);
    }
    expect(
      await new AxeBuilder({ page })
        .analyze()
        .then((result) => result.violations),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Подтвердить отправку", exact: true })
      .click();
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
    const path = new URL(page.url()).pathname;
    const id = path.split("/").at(-1) ?? "";
    await expect(page.getByRole("main")).toContainText("Подана");
    const trackerFields = page.locator("main dl").filter({
      has: page.locator("dt").filter({ hasText: /^Название мероприятия$/ }),
    });
    await expect(trackerFields.locator("dt")).toHaveText(eventFieldTitles);
    await expect(trackerFields).toContainText(dateLabel(f.payload.dateFrom));
    await expect(trackerFields).toContainText(dateLabel(f.payload.dateTo));
    const staffContext = await browser.newContext();
    try {
      const staff = await staffContext.newPage();
      await staff.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme,
      );
      await loginAsTestStaff(staff, f.limitedCredentials);
      await staff.goto(`/staff${path}`);
      await expect(staff.getByRole("main")).toContainText(f.payload.eventName);
      const staffFields = staff.locator("main dl").filter({
        has: staff.locator("dt").filter({ hasText: /^Название мероприятия$/ }),
      });
      await expect
        .poll(async () =>
          (await staffFields.locator("dt").allTextContents()).slice(-6),
        )
        .toEqual(eventFieldTitles);
      await expect(staffFields).toContainText(dateLabel(f.payload.dateFrom));
      await expect(staffFields).toContainText(dateLabel(f.payload.dateTo));
      await expect(staff.getByRole("main")).toContainText(
        f.payload.confirmation,
      );
      await expect(
        staff.getByRole("heading", { name: "Пары на время мероприятия" }),
      ).toBeVisible();
      await expect(staff.getByRole("main")).toContainText(
        "Основание: пункт 4 «Участие в мероприятиях и освобождение» положения о посещаемости",
      );
      await expect(
        staff.getByRole("link", { name: "Почему?", exact: true }),
      ).toHaveCount(0);
      await expect(staff.locator('a[href^="/regulations"]')).toHaveCount(0);
      await expect(staff.getByRole("main").getByRole("link")).toHaveAttribute(
        "href",
        "/staff/requests",
      );
      for (const [button, status] of [
        ["Принять", "Принята"],
        ["В работу", "В работе"],
        ["Готова", "Готова"],
      ] as const) {
        await staff.getByRole("button", { name: button, exact: true }).click();
        await expect(
          staff
            .locator('[data-slot="badge"]')
            .filter({ hasText: new RegExp(`^${status}$`) })
            .first(),
        ).toBeVisible();
      }
      const rows =
        await f.sql`select status, reason from attendance_records where source_key = ${`event:${id}`}`;
      expect(rows).toHaveLength(lessons.length);
      expect(
        rows.every(
          (row) =>
            row.status === "excused" && row.reason === f.payload.eventName,
        ),
      ).toBe(true);
      const readyExplanation =
        "Освобождение одобрено. Пары на время мероприятия отмечены как уважительные.";
      await page.goto(path);
      await expect(
        page
          .getByRole("heading", { name: "Что происходит?", exact: true })
          .locator(".."),
      ).toContainText(readyExplanation);
      for (const view of [page, staff]) {
        const main = view.getByRole("main");
        await expect(main.locator('[aria-current="step"]')).toContainText(
          "Готова · текущий этап",
        );
        await expect(main.locator('[aria-current="step"]')).toContainText(
          readyExplanation,
        );
        await expect(main).not.toContainText("Электронная справка");
        await expect(main).not.toContainText("бумажный документ");
        await expect(main.locator('a[href$="/pdf"]')).toHaveCount(0);
        expect(
          await new AxeBuilder({ page: view })
            .analyze()
            .then((result) => result.violations),
        ).toEqual([]);
        expect(
          await view.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          ),
        ).toBe(true);
      }
      await staff.getByRole("button", { name: "Выдать", exact: true }).click();
      await expect(
        staff.getByRole("main").getByText("Выдана", { exact: true }).first(),
      ).toBeVisible();
      const issuedExplanation =
        "Заявка завершена. Пары на время мероприятия отмечены как уважительные. История обращения останется в вашем кабинете.";
      await page.reload();
      await expect(
        page
          .getByRole("heading", { name: "Что происходит?", exact: true })
          .locator(".."),
      ).toContainText(issuedExplanation);
      for (const view of [page, staff]) {
        const main = view.getByRole("main");
        await expect(main.locator('[aria-current="step"]')).toContainText(
          "Выдана · текущий этап",
        );
        await expect(main.locator('[aria-current="step"]')).toContainText(
          issuedExplanation,
        );
        await expect(main).not.toContainText("Электронная справка");
        await expect(main).not.toContainText("бумажный документ");
        await expect(main.locator('a[href$="/pdf"]')).toHaveCount(0);
      }
      expect(
        await f.sql`select points from activity_points where source_key = ${`event:${id}`}`,
      ).toEqual([{ points: 5 }]);
    } finally {
      await staffContext.close();
    }
    await page.goto("/notifications");
    await expect(page.getByRole("main")).toContainText(
      `Освобождение одобрено: ${lessons.length} пар — уважительная причина`,
    );
    await page.goto(path);
    await page.getByRole("link", { name: "Почему?", exact: true }).click();
    await expect(page).toHaveURL(/\/regulations\/attendance#p-4$/);
    await expect(page.locator("#p-4")).toBeVisible();
  });

test("mock: уточняет и исправляет период в одном черновике, не отправляет", async ({
  page,
  eventData: f,
}) => {
  test.skip(process.env.ASSISTANT_RUNTIME !== "mock", "Нужен mock-рантайм");
  await loginAsTestStudent(page, f.studentCredentials.anna);
  await page
    .getByRole("button", { name: "Спросить или сделать", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Спросить или сделать" });
  await dialog
    .getByLabel("Ваш вопрос")
    .fill("Еду на хакатон 15–16 ноября, что с парами?");
  await dialog.getByRole("button", { name: "Задать вопрос" }).click();
  await expect(dialog.getByText(/Уточните точные даты и год/)).toBeVisible();
  await dialog.getByLabel("Ваш вопрос").fill("15–16 ноября 2026");
  await dialog.getByRole("button", { name: "Задать вопрос" }).click();
  const card = dialog.getByRole("region", { name: "Черновик заявки" });
  await expect(card).toContainText(dateLabel("2026-11-15"));
  await expect(card).toContainText(dateLabel("2026-11-16"));
  await expect(card).toContainText("Пары на время мероприятия");
  await expect(
    card.locator("dt").filter({ hasText: "Пары на время мероприятия" }),
  ).toHaveText("Пары на время мероприятия");
  for (const title of eventFieldTitles)
    await expect(
      card.locator("dt").filter({ hasText: new RegExp(`^${title} ·`) }),
    ).toHaveText(`${title} · обязательно`);
  await expect(card).toContainText("Не указано");
  await expect(
    card.getByRole("button", { name: "Подтвердить отправку" }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("link", { name: "Основание: § 4" }),
  ).toHaveAttribute("href", "/regulations/attendance#p-4");
  const edit = card.getByRole("link", { name: "Изменить", exact: true });
  await expect(edit).toHaveAttribute("href", /^\/requests\/[^/]+$/);
  const id = (await edit.getAttribute("href"))?.split("/").at(-1);
  if (!id) throw new Error("Не найдена ссылка на черновик заявки");
  const [saved] =
    await f.sql`select status, payload from requests where id = ${id}`;
  expect(saved?.status).toBe("draft");
  expect(saved?.payload).toMatchObject({
    eventName: "хакатон",
    dateFrom: "2026-11-15",
    dateTo: "2026-11-16",
  });
  expect(saved?.payload.organizer ?? "").toBe("");
  expect(saved?.payload.confirmation ?? "").toBe("");

  await dialog.getByLabel("Ваш вопрос").fill("Исправь даты: 17–18 ноября 2026");
  await dialog.getByRole("button", { name: "Задать вопрос" }).click();
  const cards = dialog.getByRole("region", { name: "Черновик заявки" });
  await expect(cards).toHaveCount(2);
  const corrected = cards.last();
  await expect(corrected).toContainText(dateLabel("2026-11-17"));
  await expect(corrected).toContainText(dateLabel("2026-11-18"));
  await expect(corrected).not.toContainText(dateLabel("2026-11-15"));
  await expect(corrected).not.toContainText(dateLabel("2026-11-16"));
  await expect(
    corrected.getByRole("link", { name: "Изменить", exact: true }),
  ).toHaveAttribute("href", `/requests/${id}`);
  await expect(
    corrected.getByRole("button", { name: "Подтвердить отправку" }),
  ).toHaveCount(0);
  const [updated] =
    await f.sql`select status, payload from requests where id = ${id}`;
  expect(updated?.status).toBe("draft");
  expect(updated?.payload).toMatchObject({
    eventName: "хакатон",
    dateFrom: "2026-11-17",
    dateTo: "2026-11-18",
  });
  expect(updated?.payload.organizer ?? "").toBe("");
  expect(updated?.payload.confirmation ?? "").toBe("");
});
