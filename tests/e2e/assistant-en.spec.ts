import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../security/assistant-fixture";

test.beforeEach(() =>
  test.skip(
    process.env.ASSISTANT_RUNTIME !== "mock",
    "Нужен сервер с ASSISTANT_RUNTIME=mock.",
  ),
);

async function expectEnglishLayout(page: Page, area: Locator) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await area.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

for (const theme of ["light", "dark"] as const) {
  for (const approved of [true, false]) {
    test(`English: черновик, ${approved ? "подтверждение" : "отказ"} и журнал · ${theme}`, async ({
      page,
      context,
      baseURL,
      loginStudent,
      assistantStudent,
    }, info) => {
      if (!baseURL) throw new Error("Укажите адрес приложения.");
      await page.addInitScript(
        (value) => localStorage.setItem("pulse-theme", value),
        theme,
      );
      await loginStudent();
      await context.addCookies([
        { name: "pulse-language", value: "en", url: baseURL },
      ]);
      await page.goto("/profile/assistant");
      const main = page.getByRole("main");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await expect(
        main.getByRole("heading", { name: "No entries yet", exact: true }),
      ).toBeVisible();
      const start = main.getByRole("button", {
        name: "Ask the assistant",
        exact: true,
      });
      await expect(start).toHaveAttribute("data-journal-ready", "true");
      await start.click();
      const sheet = page.getByRole("dialog", {
        name: "Ask or get things done",
        exact: true,
      });
      await expect(sheet.locator("[data-assistant-ready]")).toHaveAttribute(
        "data-assistant-ready",
        "true",
      );
      await expect(
        sheet.getByRole("button", {
          name: "I need a certificate for my employer",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        sheet.getByLabel("Your question", { exact: true }),
      ).toHaveAttribute(
        "placeholder",
        "For example, I need a certificate for my employer",
      );
      // The Russian question also checks that English UI preserves the model's language.
      await sheet
        .getByLabel("Your question", { exact: true })
        .fill("Как получить документ об обучении?");
      await sheet
        .getByRole("button", { name: "Ask question", exact: true })
        .click();
      await expect(
        sheet.getByText(
          "Проверьте сведения и источники ниже. Заявку отправите вы после проверки черновика.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        sheet.getByLabel("Your question", { exact: true }),
      ).toHaveValue("");
      await expect(
        sheet.getByRole("button", { name: "Ask question", exact: true }),
      ).toBeDisabled();
      const question = "Нужна справка для работодателя";
      await sheet.getByLabel("Your question", { exact: true }).fill(question);
      await expect(
        sheet.getByRole("button", { name: "Ask question", exact: true }),
      ).toBeEnabled();
      await sheet
        .getByRole("button", { name: "Ask question", exact: true })
        .click();
      const draftRegions = sheet.getByRole("region", {
        name: /^Request draft \d+: /,
      });
      await expect(draftRegions).toHaveCount(2);
      const card = draftRegions.filter({
        has: page.getByRole("heading", {
          name: "Enrolment certificate",
          exact: true,
        }),
      });
      const confirm = card.getByRole("button", {
        name: "Confirm submission",
        exact: true,
      });
      await expect(confirm).toBeEnabled();
      const position = await card.getAttribute("data-assistant-draft");
      expect(position).toMatch(/^[1-9]\d*$/);
      await expect(card).toHaveAccessibleName(
        `Request draft ${position}: Enrolment certificate`,
      );
      await expect(card).toContainText("Enrolment certificate");
      await expect(card).toContainText("Recipient");
      await expect(card).toContainText("работодателя");
      await expect(card).toContainText("3 working days");
      await expect(card).toContainText("Draft · not submitted");
      await expect(card).toContainText(
        "The request is sent only after you confirm. Review every field.",
      );
      await expect(
        card.getByRole("region", {
          name: `Profile details for draft ${position}: Enrolment certificate`,
          exact: true,
        }),
      ).toContainText("Анна Соколова");
      await expect(
        sheet.getByText("The regulation text is in Russian.").first(),
      ).toBeVisible();
      await expect(
        card.getByRole("link", { name: "Basis: § 3.2", exact: true }),
      ).toHaveAttribute("href", "/regulations/certificates#p-3-2");
      const href = await card
        .getByRole("link", { name: "Edit", exact: true })
        .getAttribute("href");
      if (!href) throw new Error("Черновик не содержит ссылки.");
      const draftId = href.slice("/requests/".length);
      const status = async () => {
        const [row] = await assistantStudent.sql`
          select status from requests
          where id = ${draftId} and student_id = ${assistantStudent.actor.studentId}`;
        return row?.status;
      };
      await expect.poll(status).toBe("draft");
      for (const button of await card.getByRole("button").all()) {
        const box = await button.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(await button.getAttribute("aria-label")).toBeNull();
        expect(
          await button.evaluate((element) => {
            const style = getComputedStyle(element);
            return [style.overflowWrap, style.wordBreak];
          }),
        ).toEqual(["normal", "normal"]);
      }
      await expectEnglishLayout(page, sheet);
      await info.attach(`assistant-en-draft-${theme}-${approved}`, {
        body: await page.screenshot({ animations: "disabled" }),
        contentType: "image/png",
      });
      await card
        .getByRole("button", {
          name: approved ? "Confirm submission" : "Do not submit",
          exact: true,
        })
        .click();
      if (approved) {
        await expect(
          card.getByRole("link", { name: /^Open request / }),
        ).toHaveAttribute("href", href);
        await expect.poll(status).toBe("submitted");
      } else {
        await expect(
          sheet.getByText(
            "Submission cancelled. Your draft is saved and can be edited in Requests.",
            { exact: true },
          ),
        ).toBeVisible();
        await expect.poll(status).toBe("draft");
      }
      await expect(
        sheet.getByText("Thinking… The answer may take a little time.", {
          exact: true,
        }),
      ).not.toBeVisible();
      await sheet
        .getByRole("link", { name: "My journal", exact: true })
        .click();
      await expect(page).toHaveURL(/\/profile\/assistant$/);
      await expect(sheet).not.toBeVisible();
      await expect(
        main.getByRole("heading", { name: "My assistant journal", level: 1 }),
      ).toBeVisible();
      await expect(main).toContainText(
        "AI submits requests only after your confirmation.",
      );
      await expect(main).toContainText("Entries are kept for 14 days.");
      await expect(main).toContainText(question);
      await expect(main).toContainText("Prepared a draft");
      await expect(main).toContainText(
        approved ? "Request submitted" : "Not submitted; draft saved",
      );
      const latest = main.getByRole("listitem").first();
      await expect(latest).toContainText("Your action");
      await expect(latest).toContainText(
        approved ? "Confirm submission" : "Do not submit",
      );
      await expect(main.locator("time").first()).toContainText("MSK");
      await expect(
        main.getByRole("link", { name: /§ 3\.2/ }).first(),
      ).toHaveAttribute("href", "/regulations/certificates#p-3-2");
      await expectEnglishLayout(page, main);
      await info.attach(`assistant-en-journal-${theme}-${approved}`, {
        body: await page.screenshot({ fullPage: true, animations: "disabled" }),
        contentType: "image/png",
      });
    });
  }
}

test("English: ошибка, повтор и кодовый ответ без ИИ", async ({
  page,
  context,
  baseURL,
  loginStudent,
}) => {
  if (!baseURL) throw new Error("Укажите адрес приложения.");
  await loginStudent();
  await context.addCookies([
    { name: "pulse-language", value: "en", url: baseURL },
  ]);
  let calls = 0;
  await page.route("**/api/assistant", (route) => {
    if (calls++ === 0)
      return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    const events = [
      { type: "start", messageId: "english-fallback" },
      {
        type: "data-assistant",
        id: "mode",
        data: { type: "mode", mode: "fallback" },
      },
      {
        type: "data-assistant",
        id: "message",
        data: { type: "message", code: "noAnswer", params: {} },
      },
      { type: "finish" },
    ];
    return route.fulfill({
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body: `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
    });
  });
  await page.goto("/profile/assistant");
  const start = page
    .getByRole("main")
    .getByRole("button", { name: "Ask the assistant", exact: true });
  await expect(start).toHaveAttribute("data-journal-ready", "true");
  await start.click();
  const sheet = page.getByRole("dialog", {
    name: "Ask or get things done",
    exact: true,
  });
  await expect(sheet.locator("[data-assistant-ready]")).toHaveAttribute(
    "data-assistant-ready",
    "true",
  );
  await sheet
    .getByLabel("Your question", { exact: true })
    .fill("Покажи расписание");
  await sheet
    .getByRole("button", { name: "Ask question", exact: true })
    .click();
  await expect(sheet.getByRole("alert")).toContainText(
    "The answer could not be completed. You can open the draft in Requests.",
  );
  await sheet.getByRole("button", { name: "Ask again", exact: true }).click();
  await expect(
    sheet.getByText("Answer without AI", { exact: true }),
  ).toBeVisible();
  await expect(
    sheet.getByText(
      "No answer could be obtained. Try again or send a question to the dean’s office.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(sheet.getByRole("alert")).toHaveCount(0);
  expect(calls).toBe(2);
  await expectEnglishLayout(page, sheet);
});
