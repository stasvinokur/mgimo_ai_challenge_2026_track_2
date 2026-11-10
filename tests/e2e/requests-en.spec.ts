import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";
import { openCertificatesFixture } from "../integration/certificates-fixture";
import {
  openPickupFixture,
  type PickupFixture,
} from "../integration/pickup-data";
import {
  type EventRequestFixture,
  openEventRequestFixture,
} from "../integration/requests-event-data";
import {
  openStudentTestData,
  type StudentTestData,
} from "../integration/student-e2e-data";
import { loginAsTestStaff } from "../security/staff-login";
import { loginAsTestStudent } from "../security/student-login";
import { certificatePdfText } from "../unit/certificates-pdf-text";

const test = base.extend<{
  student: StudentTestData;
  eventData: EventRequestFixture;
  pickupData: PickupFixture;
  certificates: Awaited<ReturnType<typeof openCertificatesFixture>>;
}>({
  student: async ({ baseURL }, use) => {
    base.skip(!process.env.DATABASE_URL, "Нужна БД для временного студента.");
    if (!baseURL) throw new Error("Укажите адрес приложения.");
    const fixture = await openStudentTestData("timur");
    try {
      await use(fixture);
    } finally {
      await fixture.close();
    }
  },
  eventData: async ({ baseURL }, use) => {
    base.skip(!process.env.DATABASE_URL, "Нужна БД для временного студента.");
    if (!baseURL) throw new Error("Укажите адрес приложения.");
    const fixture = await openEventRequestFixture();
    try {
      await use(fixture);
    } finally {
      await fixture.close();
    }
  },
  pickupData: async ({ baseURL }, use) => {
    base.skip(!process.env.DATABASE_URL, "Нужна БД для временного студента.");
    if (!baseURL) throw new Error("Укажите адрес приложения.");
    const fixture = await openPickupFixture();
    try {
      await use(fixture);
    } finally {
      await fixture.close();
    }
  },
  certificates: async ({ baseURL }, use) => {
    base.skip(!process.env.DATABASE_URL, "Нужна БД для временного студента.");
    if (!baseURL) throw new Error("Укажите адрес приложения.");
    const fixture = await openCertificatesFixture();
    try {
      await use(fixture);
    } finally {
      await fixture.close();
    }
  },
});

async function english(page: Page, baseURL: string | undefined) {
  if (!baseURL) throw new Error("Укажите адрес приложения.");
  await page
    .context()
    .addCookies([
      { name: "pulse-language", value: "en", url: baseURL, sameSite: "Lax" },
    ]);
}

async function checkPage(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.evaluate(() => document.fonts.ready);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const splitWords = await page.locator("main").evaluate((main) => {
    const split: string[] = [];
    for (const element of main.querySelectorAll("button, a, label")) {
      if (!(element instanceof HTMLElement) || !element.checkVisibility())
        continue;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of (node.textContent ?? "").matchAll(/\S+/gu)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const lines = new Set(
            Array.from(range.getClientRects()).map((rect) =>
              Math.round(rect.top),
            ),
          );
          if (lines.size > 1) split.push(match[0]);
        }
      }
    }
    return split;
  });
  expect(splitWords).toEqual([]);
}

function englishDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

for (const theme of ["light", "dark"] as const) {
  test(`English: справка работодателю, ошибки, черновик и трекер · ${theme}`, async ({
    page,
    baseURL,
    student,
  }, info) => {
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    await loginAsTestStudent(page, student.credentials);
    await english(page, baseURL);
    await page.goto("/requests");
    await expect(
      page.getByRole("heading", { name: "Requests", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "New request", exact: true }).click();
    await expect(page).toHaveURL(/\/requests\/new$/);
    await page
      .getByRole("link", {
        name: "Choose: Certificate of enrolment",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/requests\/new\?type=enrollment$/);
    const form = page.locator("#main-content").getByTestId("request-form");
    await expect(form).toHaveAttribute("data-ready", "true");
    await expect(page.locator("html")).toHaveClass(
      new RegExp(`\\b${theme}\\b`),
    );
    await form
      .getByRole("button", { name: "Check request", exact: true })
      .click();
    await expect(form.getByRole("alert")).toContainText(/check/i);
    const recipient = form.getByLabel("Recipient (required)", { exact: true });
    await expect(recipient).toHaveAttribute("aria-invalid", "true");
    await expect(form.locator('[id$="-error"]')).toContainText(/field/i);
    await checkPage(page);
    const destination = "Fictional employer «Northstar»";
    await recipient.fill(destination);
    await form.getByRole("button", { name: "Save draft", exact: true }).click();
    const saved = form.getByRole("link", {
      name: "Open saved draft",
      exact: true,
    });
    await expect(saved).toBeVisible();
    await saved.click();
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
    const requestPath = new URL(page.url()).pathname;
    await expect(form).toHaveAttribute("data-ready", "true");
    await expect(
      form.getByLabel("Recipient (required)", { exact: true }),
    ).toHaveValue(destination);
    await form
      .getByRole("button", { name: "Check request", exact: true })
      .click();
    await expect(
      form.getByRole("heading", { name: "Review your request", exact: true }),
    ).toBeVisible();
    await expect(form).toContainText(destination);
    await expect(form).toContainText(
      "The request is presented to staff in Russian.",
    );
    await checkPage(page);
    await page.screenshot({
      path: info.outputPath(`requests-review-en-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await form
      .getByRole("button", { name: "Confirm submission", exact: true })
      .click();
    await expect(page).toHaveURL(requestPath);
    await expect(
      page.getByRole("heading", { name: "Request progress", exact: true }),
    ).toBeVisible();
    await expect(page.locator("main [aria-current=step]")).toContainText(
      "Submitted",
    );
    await expect(
      page.getByRole("heading", { name: "What is happening?", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("main")).toContainText(destination);
    await checkPage(page);
    await page.screenshot({
      path: info.outputPath(`requests-tracker-en-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });

  test(`English: готовая справка, русский PDF и QR · ${theme}`, async ({
    page,
    baseURL,
    certificates: fixture,
  }, info) => {
    await page.addInitScript((value) => {
      localStorage.setItem("pulse-theme", value);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => undefined },
      });
    }, theme);
    const ready = await fixture.request();
    if (!ready.certificate) throw new Error("Нужна готовая справка.");
    await loginAsTestStudent(page, fixture.anna.credentials);
    await english(page, baseURL);
    await page.goto(`/requests/${ready.id}`);
    const card = page.getByRole("region", {
      name: "Certificate ready",
      exact: true,
    });
    await expect(card).toHaveAttribute("data-ready", "true");
    await expect(card).toContainText(ready.certificate.number);
    await expect(card).toContainText(
      "The PDF certificate and the request sent to the dean’s office remain in Russian.",
    );
    const qr = card.getByRole("img", {
      name: `QR code to verify certificate ${ready.certificate.number}`,
      exact: true,
    });
    await expect(qr).toBeVisible();
    await expect
      .poll(() =>
        qr.evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await card.getByRole("button", { name: "Link", exact: true }).click();
    await expect(card.getByRole("status")).toContainText("Link copied");
    const downloaded = page.waitForEvent("download");
    await card.getByRole("link", { name: "Download PDF", exact: true }).click();
    const download = await downloaded;
    const pdfPath = info.outputPath("certificate-en-interface.pdf");
    await download.saveAs(pdfPath);
    const pdf = await certificatePdfText(await readFile(pdfPath));
    expect(pdf).toContain("Вымышленная справка конкурсного концепта");
    expect(pdf).toContain(ready.certificate.number);
    await checkPage(page);
    await page.screenshot({
      path: info.outputPath(`requests-certificate-en-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });

  test(`English: получение справки, талон и вызов · ${theme}`, async ({
    page,
    baseURL,
    pickupData: fixture,
  }, info) => {
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    const requestId = await fixture.ready();
    await loginAsTestStudent(page, fixture.studentCredentials.anna);
    await english(page, baseURL);
    await page.goto(`/requests/${requestId}`);
    const card = page.getByTestId("pickup-card");
    await expect(card).toHaveAttribute("data-ready", "true");
    await card
      .getByLabel("Collection window", { exact: true })
      .selectOption(fixture.windowId);
    await expect(
      card.getByLabel("Collection date", { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByLabel("Collection time (MSK)", { exact: true }),
    ).toBeVisible();
    await checkPage(page);
    await card
      .getByRole("button", { name: "Book collection", exact: true })
      .click();
    const ticket = page.getByTestId("pickup-ticket");
    await expect(ticket).toBeVisible();
    const [booking] = await fixture.sql<{ id: string; ticketNo: string }[]>`
      select id, ticket_no as "ticketNo" from pickup_bookings
      where request_id = ${requestId} and status = 'booked'`;
    if (!booking) throw new Error("Не создан талон.");
    await expect(ticket).toContainText(booking.ticketNo);
    await expect(ticket).toContainText(fixture.marker);
    await checkPage(page);
    await page.screenshot({
      path: info.outputPath(`requests-pickup-ticket-en-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await fixture.bringToToday(booking.id);
    await fixture.changePickup.execute(fixture.limited, {
      id: booking.id,
      to: "called",
    });
    await page.reload();
    await expect(card).toHaveAttribute("data-ready", "true");
    await expect(ticket.getByRole("status")).toContainText("Please go to");
    await expect(ticket).toContainText(fixture.marker);
    await checkPage(page);
    await fixture.changePickup.execute(fixture.limited, {
      id: booking.id,
      to: "served",
    });
    await page.reload();
    await expect(page.getByRole("main")).toContainText("Issued");
    await expect(card).toHaveCount(0);
  });

  test(`English: освобождение, пары и русский кабинет сотрудника · ${theme}`, async ({
    page,
    browser,
    baseURL,
    eventData: fixture,
  }, info) => {
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    await loginAsTestStudent(page, fixture.studentCredentials.anna);
    await english(page, baseURL);
    await page.goto("/requests/new?type=event_release");
    const form = page.locator("#main-content").getByTestId("request-form");
    await expect(form).toHaveAttribute("data-ready", "true");
    const fields = [
      ["Event name", fixture.payload.eventName],
      ["Organiser", fixture.payload.organizer],
      ["From date", fixture.payload.dateFrom],
      ["To date", fixture.payload.dateTo],
      ["Participation format", fixture.payload.eventFormat],
      ["Confirmation: link or invitation text", fixture.payload.confirmation],
    ] as const;
    await expect(form.locator("form label")).toHaveText(
      fields.map(([label]) => `${label} (required)`),
    );
    for (const [label, value] of fields)
      await form.getByLabel(`${label} (required)`, { exact: true }).fill(value);
    await form
      .getByRole("button", { name: "Check request", exact: true })
      .click();
    await expect(
      form.getByRole("heading", { name: "Review your request", exact: true }),
    ).toBeVisible();
    await expect(form).toContainText(englishDate(fixture.payload.dateFrom));
    await expect(form).toContainText(englishDate(fixture.payload.dateTo));
    const lessons = await fixture.preview.execute(fixture.anna, {
      dateFrom: fixture.payload.dateFrom,
      dateTo: fixture.payload.dateTo,
    });
    expect(lessons.length).toBeGreaterThan(0);
    for (const lesson of lessons)
      await expect(form).toContainText(lesson.course);
    await checkPage(page);
    await page.screenshot({
      path: info.outputPath(`requests-event-review-en-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await form
      .getByRole("button", { name: "Confirm submission", exact: true })
      .click();
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
    const path = new URL(page.url()).pathname;
    const staffContext = await browser.newContext({ baseURL });
    try {
      const staff = await staffContext.newPage();
      await loginAsTestStaff(staff, fixture.limitedCredentials);
      await english(staff, baseURL);
      await staff.goto(`/staff${path}`);
      await expect(staff.getByRole("main")).toContainText(
        "Название мероприятия",
      );
      await expect(staff.getByRole("main")).toContainText(
        fixture.payload.eventName,
      );
      await expect(
        staff.getByRole("heading", {
          name: "Пары на время мероприятия",
          exact: true,
        }),
      ).toBeVisible();
      // Fixture time predates the browser submission; transitions need server time.
      for (const [button, status] of [
        ["Принять", "Принята"],
        ["В работу", "В работе"],
        ["Готова", "Готова"],
      ] as const) {
        await staff.getByRole("button", { name: button, exact: true }).click();
        await expect(
          staff.getByRole("main").locator('[aria-current="step"]'),
        ).toContainText(`${status} · текущий этап`);
      }
    } finally {
      await staffContext.close();
    }
    await page.reload();
    await expect(
      page.getByRole("main").locator('[aria-current="step"]'),
    ).toContainText("Ready");
    await expect(page.getByRole("main")).toContainText(/exemption.*approved/i);
    await expect(page.locator('main a[href$="/pdf"]')).toHaveCount(0);
    for (const lesson of lessons)
      await expect(page.getByRole("main")).toContainText(lesson.course);
    await checkPage(page);
    await page.screenshot({
      path: info.outputPath(`requests-event-approved-en-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}
