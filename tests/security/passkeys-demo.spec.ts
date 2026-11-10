import { randomUUID } from "node:crypto";
import type { PasskeyRegistrationOptions } from "@/application/ports/passkey-verifier";
import { DEMO_PASSKEY_DEVICE_NAME } from "@/domain/identity/passkey-policy";
import { identityMessages } from "@/ui/i18n/dictionaries/identity";
import { loginMessages } from "@/ui/i18n/dictionaries/login";
import { t } from "@/ui/i18n/translate";
import { FakeClock } from "../fakes/clock";
import { withIsolatedDemoRefresh } from "../integration/passkey-demo-refresh";
import { openStudentTestData } from "../integration/student-e2e-data";
import {
  browserJson,
  expect,
  type PasskeyDTO,
  registerKey,
  registrationResponse,
  test,
} from "./passkey-fixture";
import { loginAsTestStudent } from "./student-login";

for (const role of ["student", "staff"] as const) {
  test.describe(`защита демо-ключей · ${role}`, () => {
    test.use({ passkeyRole: role, passkeyDemoAccount: true });

    test("POST и JSON скрывают имя посетителя, свежий ключ переживает очистку и позволяет войти", async ({
      page,
      context,
      passkeyAccount: account,
      authenticator,
    }) => {
      expect(authenticator.id).toBeTruthy();
      await account.login(page);
      await page.goto(account.profile);
      const injectedName = "Текст посетителя, который не должен сохраниться";
      const options = await browserJson<PasskeyRegistrationOptions>(
        page,
        "/api/passkeys/registration/options",
        "POST",
        {},
      );
      expect(options.status).toBe(200);
      const response = await registrationResponse(page, options.body);
      const registration = await browserJson(
        page,
        "/api/passkeys/registration/verify",
        "POST",
        { deviceName: injectedName, response },
      );
      expect(registration).toEqual({ status: 200, body: { ok: true } });
      const [stored] = await account.sql<
        { id: string; deviceName: string; createdAt: Date }[]
      >`
        select id, device_name as "deviceName", created_at as "createdAt"
        from passkey_credentials where user_id = ${account.actor.userId}`;
      expect(stored?.deviceName).toBe(DEMO_PASSKEY_DEVICE_NAME);
      expect(stored?.deviceName).not.toContain(injectedName);
      if (!stored) throw new Error("Не создан ключ временного демо-аккаунта.");
      const [legacy] = await account.sql<
        { id: string; deviceName: string; createdAt: Date }[]
      >`
        update passkey_credentials set device_name = ${injectedName}
        where id = ${stored.id} and user_id = ${account.actor.userId}
        returning id, device_name as "deviceName", created_at as "createdAt"`;
      expect(legacy).toEqual({ ...stored, deviceName: injectedName });
      const legacyList = await browserJson<{ credentials: PasskeyDTO[] }>(
        page,
        "/api/passkeys",
      );
      expect(legacyList.status).toBe(200);
      expect(legacyList.body.credentials).toHaveLength(1);
      expect(legacyList.body.credentials[0]).toMatchObject({
        id: stored.id,
        deviceName: DEMO_PASSKEY_DEVICE_NAME,
      });
      expect(JSON.stringify(legacyList.body)).not.toContain(injectedName);
      const legacyDetail = await browserJson<PasskeyDTO>(
        page,
        `/api/passkeys/${stored.id}`,
      );
      expect(legacyDetail.status).toBe(200);
      expect(legacyDetail.body).toMatchObject({
        id: stored.id,
        deviceName: DEMO_PASSKEY_DEVICE_NAME,
      });
      expect(JSON.stringify(legacyDetail.body)).not.toContain(injectedName);
      const deletion = await browserJson(
        page,
        `/api/passkeys/${stored.id}`,
        "DELETE",
      );
      const missingDeletion = await browserJson(
        page,
        `/api/passkeys/${randomUUID()}`,
        "DELETE",
      );
      expect(deletion.status).toBe(404);
      expect(deletion).toEqual(missingDeletion);
      const [afterDeletion] = await account.sql<
        { id: string; deviceName: string; createdAt: Date }[]
      >`
        select id, device_name as "deviceName", created_at as "createdAt"
        from passkey_credentials where user_id = ${account.actor.userId}`;
      expect(afterDeletion).toEqual(legacy);
      const clock = new FakeClock(stored.createdAt);
      clock.advance(2 * 60_000);
      await withIsolatedDemoRefresh(account.sql, clock, async (tx) => {
        const [preserved] = await tx<
          { id: string; deviceName: string; createdAt: Date }[]
        >`
          select id, device_name as "deviceName", created_at as "createdAt"
          from passkey_credentials where user_id = ${account.actor.userId}`;
        expect(preserved).toEqual(legacy);
      });
      await page.reload();
      const card = page.getByRole("region", {
        name: t("ru", identityMessages, "passkeysTitle"),
        exact: true,
      });
      await expect(
        card.getByText(t("ru", identityMessages, "demoPasskeyName"), {
          exact: true,
        }),
      ).toBeVisible();
      await expect(card).not.toContainText(injectedName);
      await page
        .getByRole("button", {
          name: t("ru", identityMessages, "signOut"),
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(/\/login$/);
      expect(
        (await context.cookies()).some(
          (cookie) => cookie.name === "__Host-pulse-session",
        ),
      ).toBe(false);
      await page
        .getByRole("button", {
          name: t("ru", loginMessages, "passkey"),
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(new RegExp(`${account.home}$`));
      const list = await browserJson<{ credentials: PasskeyDTO[] }>(
        page,
        "/api/passkeys",
      );
      expect(list.status).toBe(200);
      expect(list.body.credentials).toHaveLength(1);
      expect(list.body.credentials[0]).toMatchObject({
        id: stored.id,
        deviceName: DEMO_PASSKEY_DEVICE_NAME,
      });
      expect(list.body.credentials[0]?.lastUsedAt).toBeTruthy();
    });
  });
}

test("обычное имя устройства сохраняется в JSON списка и отдельного ключа", async ({
  page,
  passkeyAccount: account,
  authenticator,
}) => {
  expect(authenticator.id).toBeTruthy();
  await account.login(page);
  await page.goto(account.profile);
  const deviceName = "Личный учебный телефон";
  const key = await registerKey(page, deviceName);
  const list = await browserJson<{
    credentials: PasskeyDTO[];
    isDemoAccount: boolean;
  }>(page, "/api/passkeys");
  expect(list.status).toBe(200);
  expect(list.body.isDemoAccount).toBe(false);
  expect(list.body.credentials).toContainEqual(key);
  const detail = await browserJson<PasskeyDTO>(page, `/api/passkeys/${key.id}`);
  expect(detail).toEqual({ status: 200, body: key });
  expect(detail.body.deviceName).toBe(deviceName);
});

test.describe("признак демо из сессии", () => {
  test.use({ passkeyDemoAccount: true });

  test("userId и isDemoAccount в query не меняют признак текущего пользователя", async ({
    page,
    passkeyAccount: demo,
  }) => {
    const ordinary = await openStudentTestData("timur");
    try {
      await demo.login(page);
      const demoList = await browserJson<{
        credentials: PasskeyDTO[];
        isDemoAccount: boolean;
      }>(
        page,
        `/api/passkeys?userId=${ordinary.actor.userId}&isDemoAccount=false`,
      );
      expect(demoList).toEqual({
        status: 200,
        body: { credentials: [], isDemoAccount: true },
      });
      // The sign-out button lives in the profile, not on the page the login lands on.
      await page.goto("/profile");
      await page
        .getByRole("button", {
          name: t("ru", identityMessages, "signOut"),
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(/\/login$/);
      await loginAsTestStudent(page, ordinary.credentials);
      const ordinaryList = await browserJson<{
        credentials: PasskeyDTO[];
        isDemoAccount: boolean;
      }>(page, `/api/passkeys?userId=${demo.actor.userId}&isDemoAccount=true`);
      expect(ordinaryList).toEqual({
        status: 200,
        body: { credentials: [], isDemoAccount: false },
      });
    } finally {
      await ordinary.close();
    }
  });
});
