import { expect, test } from "../security/student-login";

test("Почему? открывает нужный пункт положения, положения доступны из кабинета", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  await page.goto("/grades");
  await page
    .getByTestId("grade-course")
    .first()
    .getByRole("link", { name: /^Почему\?/ })
    .click();
  await expect(page).toHaveURL(/\/regulations\/assessment#p-4$/);
  await expect(page.locator("#p-4")).toBeInViewport();
  await page.goBack();
  await expect(page).toHaveURL(/\/grades$/);
  const scholarshipWhy = page.getByRole("link", {
    name: "Почему? Правила стипендии",
    exact: true,
  });
  await expect(scholarshipWhy).toHaveCount(1);
  await expect(
    page
      .locator("#scholarship")
      .getByRole("link", { name: "Почему? Правила стипендии", exact: true }),
  ).toHaveCount(1);
  await scholarshipWhy.click();
  await expect(page).toHaveURL(/\/regulations\/scholarship#p-2$/);
  await expect(page.locator("#p-2")).toBeInViewport();
  await page.goto("/today");
  await page
    .getByRole("link", { name: "Положения деканата", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/regulations$/);
  await expect(
    page.getByRole("heading", {
      name: "Положения деканата",
      level: 1,
      exact: true,
    }),
  ).toBeVisible();
});

test("уведомления называют действие по смыслу и показывают даты по-человечески", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  await page.goto("/notifications");
  const change = page.locator("li[data-notification-id]").filter({
    has: page.getByRole("heading", { name: "Пара перенесена", exact: true }),
  });
  await expect(
    change.getByRole("link", { name: "Открыть расписание", exact: true }),
  ).toBeVisible();
  await expect(change).not.toContainText(/\d{4}-\d{2}-\d{2}/);
  const deadline = page.locator("li[data-notification-id]").filter({
    has: page.getByRole("heading", {
      name: "Остался итоговый тест",
      exact: true,
    }),
  });
  await expect(
    deadline.getByRole("link", { name: "Открыть успеваемость", exact: true }),
  ).toBeVisible();
  const certificate = page.locator("li[data-notification-id]").filter({
    has: page.getByRole("heading", {
      name: "Справка об обучении готова",
      exact: true,
    }),
  });
  await expect(
    certificate.getByRole("link", { name: "Открыть заявку", exact: true }),
  ).toBeVisible();
});

test("веб-обзор: шесть дней, текущий день и переход к своей заявке", async ({
  page,
  loginAs,
}, info) => {
  await loginAs("anna");
  await page.goto("/today");
  const week = page.getByTestId("today-week");
  const requests = page.getByTestId("today-requests");
  const assistant = page.getByTestId("today-assistant");
  if (info.project.name === "mobile-360") {
    await expect(week).toBeHidden();
    await expect(requests).toBeHidden();
    await expect(assistant).toBeHidden();
    await expect(
      page.getByRole("textbox", { name: "Ваш вопрос", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Где следующая пара?", exact: true }),
    ).toHaveCount(0);
    return;
  }
  await expect(week).toBeVisible();
  await expect(week.getByTestId("today-week-day")).toHaveCount(6);
  const now = await page.getByTestId("pulse-now").getAttribute("datetime");
  if (!now) throw new Error("Нужно время обзора.");
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    weekday: "short",
  }).format(new Date(now));
  const selected = week.locator('[aria-current="date"]');
  await expect(selected).toHaveCount(weekday === "Sun" ? 0 : 1);
  if (weekday !== "Sun") await expect(selected).toContainText("сегодня");
  await week.getByRole("link", { name: "Вся неделя", exact: true }).click();
  await expect(page).toHaveURL(/\/schedule\?view=week&week=\d{4}-W\d{2}$/);
  await expect(
    page.getByRole("link", { name: "Неделя", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page).toHaveURL(/\/today$/);
  const ownRequest = requests.getByTestId("today-request").first();
  await expect(ownRequest).toBeVisible();
  await expect(
    ownRequest.getByRole("img", { name: /этап [123] из 5/ }),
  ).toBeVisible();
  await expect(ownRequest).toContainText("Ожидаемая дата:");
  const href = await ownRequest.getAttribute("href");
  await ownRequest.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(
    page.getByRole("heading", { name: "Путь заявки", exact: true }),
  ).toBeVisible();
});

test("долг Тимура выделен в сводке и объясняет следующий шаг", async ({
  page,
  loginAs,
}) => {
  await loginAs("timur");
  await page.goto("/today");
  const study = page.getByTestId("today-study");
  await expect(study).toContainText("есть долг");
  await expect(study).toContainText("согласуйте срок сдачи");
  await expect(study).toHaveClass(/danger-bg/);
  await study.getByRole("link", { name: /^Открыть успеваемость/ }).click();
  await expect(page).toHaveURL(/\/grades$/);
});
