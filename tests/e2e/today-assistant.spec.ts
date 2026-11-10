import { expect, test } from "../security/assistant-fixture";

test("карточка Сегодня открывает единую шторку, отправляет поле и чип в mock-рантайм", async ({
  page,
  loginStudent,
}, info) => {
  test.skip(
    info.project.name === "mobile-360",
    "Карточка видна от 1024 px; телефон использует FAB.",
  );
  test.skip(
    process.env.ASSISTANT_RUNTIME !== "mock",
    "Нужен сервер с ASSISTANT_RUNTIME=mock.",
  );
  await loginStudent();
  await page.goto("/today");
  const card = page.getByTestId("today-assistant");
  await expect(card).toBeVisible();
  const sent: { question: string; threadId: string }[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/assistant"
    )
      sent.push(request.postDataJSON());
  });
  const input = card.getByLabel("Ваш вопрос", { exact: true });
  await input.fill("Что изменилось?");
  await input.press("Enter");
  const sheet = page.getByRole("dialog", {
    name: "Спросить или сделать",
    exact: true,
  });
  await expect(sheet).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(sheet.getByRole("log")).toContainText("Что изменилось?");
  await expect(sheet.getByRole("log")).toContainText(
    "Проверьте сведения и источники ниже.",
  );
  await expect(
    sheet.getByRole("button", { name: "Есть ли долги?", exact: true }),
  ).toBeEnabled();
  expect(sent.map((item) => item.question)).toEqual(["Что изменилось?"]);
  await page.keyboard.press("Escape");
  await expect(input).toBeFocused();
  const chip = card.getByRole("button", {
    name: "Есть ли долги?",
    exact: true,
  });
  await chip.click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("log").locator("article")).toHaveCount(4);
  await expect(
    sheet.getByRole("button", { name: "Есть ли долги?", exact: true }),
  ).toBeEnabled();
  expect(sent.map((item) => item.question)).toEqual([
    "Что изменилось?",
    "Есть ли долги?",
  ]);
  expect(sent[1]?.threadId).toBe(sent[0]?.threadId);
  await page.keyboard.press("Escape");
  await expect(chip).toBeFocused();
});
