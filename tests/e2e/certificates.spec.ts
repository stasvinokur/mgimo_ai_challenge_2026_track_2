import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { LocalQrEncoder } from "@/infrastructure/pdf/qr-encoder";
import { expect, test } from "../security/certificates-fixture";
import { loginAsTestStudent } from "../security/student-login";
import { certificatePdfHasQrUrl } from "../unit/certificates-pdf-qr";
import { certificatePdfText } from "../unit/certificates-pdf-text";
import { attachCertificatePdfScreenshot } from "./certificates-pdf-screenshot";

test("студент скачивает PDF из трекера; публичные состояния и снимки", async ({
  page,
  browser,
  certificates: f,
  certificateIp,
  baseURL,
}, testInfo) => {
  const ready = await f.request();
  const certificate = ready.certificate;
  if (!certificate) throw new Error("Нужна готовая справка.");
  await loginAsTestStudent(page, f.anna.credentials);
  await page.goto(`/requests/${ready.id}`);
  const downloadPromise = page.waitForEvent("download");
  const card = page.getByRole("region", { name: "Готовая справка" });
  await expect(card).toContainText(certificate.number);
  await card.getByRole("link", { name: "Скачать PDF", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    `spravka-${certificate.number}.pdf`,
  );
  const pdfPath = testInfo.outputPath("certificate.pdf");
  await download.saveAs(pdfPath);
  const bytes = await readFile(pdfPath);
  expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  const text = await certificatePdfText(bytes);
  expect(text).toContain(certificate.number);
  expect(text).toContain("Вымышленная справка конкурсного концепта");
  expect(text).toContain("Не является официальным документом");
  const origin = process.env.APP_ORIGIN ?? baseURL;
  if (!origin) throw new Error("Нужен адрес приложения для проверки QR.");
  expect(
    await certificatePdfHasQrUrl(
      bytes,
      new URL(`/verify/${certificate.verifyCode}`, origin).href,
    ),
  ).toBe(true);
  await testInfo.attach("Вымышленная справка", {
    path: pdfPath,
    contentType: "application/pdf",
  });
  await mkdir(resolve("docs/screenshots"), { recursive: true });
  const prefix = resolve(
    `docs/screenshots/certificates-pdf-first-page-${testInfo.project.name}`,
  );
  await attachCertificatePdfScreenshot(pdfPath, prefix, testInfo);

  const publicContext = await browser.newContext({
    viewport: page.viewportSize(),
    extraHTTPHeaders: { "x-forwarded-for": certificateIp },
  });
  try {
    const publicPage = await publicContext.newPage();
    for (const state of ["valid", "revoked", "missing"] as const) {
      if (state === "revoked") await f.revoke(ready.id);
      const response = await publicPage.goto(
        `/verify/${state === "missing" ? "A".repeat(26) : certificate.verifyCode}`,
      );
      expect(response?.status()).toBe(state === "missing" ? 404 : 200);
      await expect(
        publicPage.getByRole("heading", {
          name:
            state === "valid"
              ? "Справка действительна"
              : state === "revoked"
                ? "Отозвана"
                : "Справка не найдена",
          exact: true,
        }),
      ).toBeVisible();
      if (state !== "missing")
        await expect(
          publicPage.getByText("Соколова А.", { exact: true }),
        ).toBeVisible();
      await expect(
        publicPage.getByText(
          "Конкурсный концепт MGIMO×AI Challenge. Не официальный сервис МГИМО. Все данные вымышлены",
          { exact: true },
        ),
      ).toBeVisible();
      await publicPage.evaluate(() => document.fonts.ready);
      expect(
        await publicPage
          .locator(".verification-brand img")
          .evaluate(
            (image) =>
              image instanceof HTMLImageElement && image.naturalWidth > 0,
          ),
      ).toBe(true);
      expect(
        await publicPage.evaluate(() =>
          Array.from(document.fonts).every((font) => font.status === "loaded"),
        ),
      ).toBe(true);
      expect(
        await publicPage.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page: publicPage })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await publicPage.screenshot({
        path: resolve(
          `docs/screenshots/certificates-${state}-${testInfo.project.name}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
    }
  } finally {
    await publicContext.close();
  }
});

for (const theme of ["light", "dark"] as const)
  test(`готовая карточка появляется по пульсу; QR, ссылка, отзыв и axe · ${theme}`, async ({
    page,
    certificates: f,
    baseURL,
  }, info) => {
    test.setTimeout(60_000);
    await page.addInitScript((value) => {
      localStorage.setItem("pulse-theme", value);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (
              window as typeof window & { copiedCertificateLink?: string }
            ).copiedCertificateLink = text;
          },
        },
      });
    }, theme);
    const pending = await f.request("submitted");
    await loginAsTestStudent(page, f.anna.credentials);
    await page.goto(`/requests/${pending.id}`);
    await expect(page.locator("[aria-current=step]")).toContainText("Подана");
    const card = page.getByRole("region", { name: "Готовая справка" });
    await expect(card).toHaveCount(0);
    const documentToken = await page.evaluate(() => {
      const token = crypto.randomUUID();
      (
        window as typeof window & { certificateDocumentToken?: string }
      ).certificateDocumentToken = token;
      return token;
    });
    for (const to of ["accepted", "in_progress", "ready"] as const)
      await f.staff.change.execute(f.staff.limited, { id: pending.id, to });
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(page.locator("[aria-current=step]")).toContainText("Готова");
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { certificateDocumentToken?: string })
            .certificateDocumentToken,
      ),
    ).toBe(documentToken);
    const certificate = await f.repo.findByRequestIdForStudent(
      pending.id,
      f.anna.actor.studentId,
    );
    if (!certificate) throw new Error("Нужна справка");
    const origin = process.env.APP_ORIGIN ?? baseURL;
    if (!origin) throw new Error("Нужен адрес приложения");
    const url = new URL(`/verify/${certificate.verifyCode}`, origin).href;
    const qr = card.getByRole("img", {
      name: `QR-код проверки справки ${certificate.number}`,
      exact: true,
    });
    await expect(qr).toHaveAttribute(
      "src",
      `data:image/png;base64,${Buffer.from(await new LocalQrEncoder().encode(url)).toString("base64")}`,
    );
    await expect
      .poll(() => qr.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBe(320);
    await card.getByRole("button", { name: "Ссылка", exact: true }).click();
    await expect(card.getByRole("status")).toContainText("Ссылка скопирована");
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { copiedCertificateLink?: string })
            .copiedCertificateLink,
      ),
    ).toBe(url);
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      }),
    );
    await card.getByRole("button", { name: "Ссылка", exact: true }).click();
    await expect(card.getByRole("status")).toContainText(
      "Выделите и скопируйте адрес",
    );
    await expect(card.getByRole("status")).toContainText(url);
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error("denied");
          },
        },
      }),
    );
    await card.getByRole("button", { name: "Ссылка", exact: true }).click();
    await expect(card.getByRole("status")).toContainText(url);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await mkdir(resolve("docs/screenshots"), { recursive: true });
    await page.screenshot({
      path: resolve(
        `docs/screenshots/certificates-card-${theme}-${info.project.name}.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });
    const verified = await page.request.get(new URL(url).pathname);
    expect(verified.status()).toBe(200);
    expect(await verified.text()).toContain("Справка действительна");
    await f.revoke(pending.id);
    await page.reload();
    await expect(card).toContainText("Справка отозвана");
    await expect(qr).toBeVisible();
    await expect(
      card.getByRole("link", { name: "Скачать PDF", exact: true }),
    ).toHaveAttribute("href", `/api/requests/${pending.id}/pdf`);
  });
