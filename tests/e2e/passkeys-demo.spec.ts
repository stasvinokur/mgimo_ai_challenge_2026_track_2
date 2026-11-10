import AxeBuilder from "@axe-core/playwright";
import { identityMessages } from "@/ui/i18n/dictionaries/identity";
import { t } from "@/ui/i18n/translate";
import {
  browserJson,
  expect,
  passkeyOrigin,
  test,
} from "../security/passkey-fixture";

for (const language of ["ru", "en"] as const) {
  for (const demoAccount of [false, true]) {
    test.describe(`профиль ключей · ${language} · ${demoAccount ? "демо" : "обычный"}`, () => {
      test.use({ passkeyDemoAccount: demoAccount });

      test("поле имени соответствует типу аккаунта, подписи доступны и помещаются на экране", async ({
        page,
        context,
        passkeyAccount: account,
        authenticator,
      }, info) => {
        expect(authenticator.id).toBeTruthy();
        if (info.project.name === "desktop")
          await page.setViewportSize({ width: 1440, height: 900 });
        await account.login(page);
        await context.addCookies([
          { name: "pulse-language", value: language, url: passkeyOrigin },
        ]);
        await page.goto(account.profile);
        const card = page.getByRole("region", {
          name: t(language, identityMessages, "passkeysTitle"),
          exact: true,
        });
        await expect(card).toHaveAttribute("data-profile-anchor-ready", "true");
        await expect(
          card.getByText(t(language, identityMessages, "passkeysEmpty"), {
            exact: true,
          }),
        ).toBeVisible();
        const name = card.getByLabel(
          t(language, identityMessages, "deviceName"),
          { exact: true },
        );
        const notice = card.getByText(
          t(language, identityMessages, "demoPasskeyNotice"),
          { exact: true },
        );
        if (demoAccount) {
          await expect(name).toHaveCount(0);
          await expect(card.locator('input[name="deviceName"]')).toHaveCount(0);
          await expect(notice).toBeVisible();
        } else {
          await expect(name).toBeVisible();
          await expect(name).toBeEnabled();
          await expect(notice).toHaveCount(0);
          await name.fill("Учебный телефон");
        }
        const add = card.getByRole("button", {
          name: t(language, identityMessages, "addKey"),
          exact: true,
        });
        await expect(add).toBeEnabled();
        await add.click();
        await expect(
          card.getByRole("status").filter({
            hasText: t(language, identityMessages, "passkeyAdded"),
          }),
        ).toBeVisible();
        await expect(
          card.getByText(
            demoAccount
              ? t(language, identityMessages, "demoPasskeyName")
              : "Учебный телефон",
            { exact: true },
          ),
        ).toBeVisible();
        const remove = card.getByRole("button", {
          name: new RegExp(`^${t(language, identityMessages, "remove")} `),
        });
        const removalNotice = card.getByText(
          t(language, identityMessages, "demoPasskeyRemovalNotice"),
          { exact: true },
        );
        if (demoAccount) {
          await expect(remove).toHaveCount(0);
          await expect(removalNotice).toBeVisible();
        } else {
          await expect(remove).toBeVisible();
          await expect(remove).toBeEnabled();
          await expect(removalNotice).toHaveCount(0);
        }
        const response = await browserJson<{
          isDemoAccount: boolean;
          credentials: unknown[];
        }>(page, "/api/passkeys");
        expect(response.status).toBe(200);
        expect(response.body.isDemoAccount).toBe(demoAccount);
        expect(response.body.credentials).toHaveLength(1);
        await page.evaluate(() => document.fonts.ready);
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
          .toBe(true);
        for (const button of await card.getByRole("button").all()) {
          await expect(button).toBeVisible();
          const metrics = await button.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return {
              width: box.width,
              height: box.height,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
            };
          });
          expect(metrics.width).toBeGreaterThanOrEqual(44);
          expect(metrics.height).toBeGreaterThanOrEqual(44);
          expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
        }
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
        await info.attach(
          `passkeys-${language}-${demoAccount ? "demo" : "ordinary"}`,
          {
            body: await page.screenshot({
              fullPage: true,
              animations: "disabled",
            }),
            contentType: "image/png",
          },
        );
      });
    });
  }
}
