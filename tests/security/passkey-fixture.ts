import { randomUUID } from "node:crypto";
import {
  test as base,
  type CDPSession,
  expect,
  type Page,
} from "@playwright/test";
import type {
  PasskeyAuthenticationOptions,
  PasskeyAuthenticationResponse,
  PasskeyRegistrationOptions,
  PasskeyRegistrationResponse,
} from "@/application/ports/passkey-verifier";
import { createDatabase } from "@/infrastructure/db/client";
import { openStaffFixture } from "../integration/staff-fixtures";
import { openStudentTestData } from "../integration/student-e2e-data";
import { loginAsTestStaff } from "./staff-login";
import { loginAsTestStudent } from "./student-login";

export type PasskeyRole = "student" | "staff";

const configuredURL = new URL(
  process.env.PLAYWRIGHT_BASE_URL ||
    `http://localhost:${process.env.PORT || "3000"}`,
);
configuredURL.hostname = "localhost";
export const passkeyOrigin = configuredURL.origin;

export interface PasskeyDTO {
  id: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

async function openAccount(role: PasskeyRole, demoAccount: boolean) {
  const fixture =
    role === "student"
      ? await openStudentTestData("anna")
      : await openStaffFixture();
  const sql = createDatabase(1);
  const credentials =
    "limitedCredentials" in fixture
      ? fixture.limitedCredentials
      : fixture.credentials;
  const actor = "limited" in fixture ? fixture.limited : fixture.actor;
  if (demoAccount) {
    try {
      await sql`update users set seed_key = ${`passkey-test:${actor.userId}`}
        where id = ${actor.userId}`;
    } catch (error) {
      await fixture.close();
      await sql.end({ timeout: 1 });
      throw error;
    }
  }
  return {
    actor,
    credentials,
    sql,
    home: role === "student" ? "/today" : "/staff/requests",
    profile: role === "student" ? "/profile" : "/staff/profile",
    async login(page: Page) {
      if (role === "student") await loginAsTestStudent(page, credentials);
      else await loginAsTestStaff(page, credentials);
    },
    async close() {
      try {
        await fixture.close();
      } finally {
        await sql.end({ timeout: 1 });
      }
    },
  };
}

export type PasskeyAccount = Awaited<ReturnType<typeof openAccount>>;

export const test = base.extend<{
  passkeyRole: PasskeyRole;
  passkeyDemoAccount: boolean;
  passkeyConditionalAutofill: boolean;
  passkeyAccount: PasskeyAccount;
  authenticator: { session: CDPSession; id: string };
}>({
  baseURL: passkeyOrigin,
  passkeyRole: ["student", { option: true }],
  passkeyDemoAccount: [false, { option: true }],
  passkeyConditionalAutofill: [false, { option: true }],
  page: async ({ page, context, passkeyConditionalAutofill }, use) => {
    const suffix = randomUUID().replaceAll("-", "");
    await context.setExtraHTTPHeaders({
      "X-Forwarded-For": `2001:db8:${suffix.slice(0, 4)}:${suffix.slice(4, 8)}::1`,
    });
    await page.addInitScript((conditionalAutofill) => {
      // Choose the browser capability explicitly instead of relying on the host.
      if (typeof PublicKeyCredential !== "undefined")
        Object.defineProperty(
          PublicKeyCredential,
          "isConditionalMediationAvailable",
          { configurable: true, value: async () => conditionalAutofill },
        );
    }, passkeyConditionalAutofill);
    await use(page);
  },
  passkeyAccount: async ({ passkeyRole, passkeyDemoAccount }, use) => {
    base.skip(!process.env.DATABASE_URL, "Нужна тестовая БД лейна.");
    const account = await openAccount(passkeyRole, passkeyDemoAccount);
    try {
      await use(account);
    } finally {
      await account.close();
    }
  },
  authenticator: async ({ page, context }, use) => {
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
    try {
      await use({ session, id: authenticatorId });
    } finally {
      await session.send("WebAuthn.removeVirtualAuthenticator", {
        authenticatorId,
      });
      await session.detach();
    }
  },
});

export { expect };

export async function browserJson<T>(
  page: Page,
  path: string,
  method = "GET",
  body?: unknown,
) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        headers:
          body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as T };
    },
    { path, method, body },
  );
}

export async function registerKey(page: Page, deviceName: string) {
  const card = page.getByRole("region", { name: "Ключи доступа", exact: true });
  await expect(card).toBeVisible();
  await card
    .getByLabel("Название устройства", { exact: true })
    .fill(deviceName);
  await card
    .getByRole("button", { name: "Добавить ключ", exact: true })
    .click();
  await expect(card.getByText(deviceName, { exact: true })).toBeVisible();
  const response = await browserJson<{ credentials: PasskeyDTO[] }>(
    page,
    "/api/passkeys",
  );
  expect(response.status).toBe(200);
  const key = response.body.credentials.find(
    (credential) => credential.deviceName === deviceName,
  );
  expect(key).toBeDefined();
  if (!key) throw new Error("Ключ доступа не появился в списке.");
  return key;
}

export async function authenticationResponse(
  page: Page,
  options: PasskeyAuthenticationOptions,
): Promise<PasskeyAuthenticationResponse> {
  return page.evaluate(async (options) => {
    function decode(value: string) {
      return Uint8Array.from(
        atob(value.replace(/-/g, "+").replace(/_/g, "/")),
        (character) => character.charCodeAt(0),
      );
    }
    function encode(value: ArrayBuffer) {
      return btoa(String.fromCharCode(...new Uint8Array(value)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    }
    const credential = (await navigator.credentials.get({
      publicKey: {
        ...options,
        challenge: decode(options.challenge),
        allowCredentials: options.allowCredentials.map((credential) => ({
          id: decode(credential.id),
          type: credential.type,
          transports: credential.transports as
            | AuthenticatorTransport[]
            | undefined,
        })),
      },
    })) as PublicKeyCredential | null;
    if (!credential) throw new Error("Аутентификатор не вернул ответ.");
    const response = credential.response as AuthenticatorAssertionResponse;
    return {
      id: credential.id,
      rawId: encode(credential.rawId),
      type: "public-key" as const,
      clientExtensionResults: { ...credential.getClientExtensionResults() },
      response: {
        clientDataJSON: encode(response.clientDataJSON),
        authenticatorData: encode(response.authenticatorData),
        signature: encode(response.signature),
        ...(response.userHandle
          ? { userHandle: encode(response.userHandle) }
          : {}),
      },
    };
  }, options);
}

export async function registrationResponse(
  page: Page,
  options: PasskeyRegistrationOptions,
): Promise<PasskeyRegistrationResponse> {
  return page.evaluate(async (options) => {
    function decode(value: string) {
      return Uint8Array.from(
        atob(value.replace(/-/g, "+").replace(/_/g, "/")),
        (character) => character.charCodeAt(0),
      );
    }
    function encode(value: ArrayBuffer) {
      return btoa(String.fromCharCode(...new Uint8Array(value)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    }
    const credential = (await navigator.credentials.create({
      publicKey: {
        ...options,
        challenge: decode(options.challenge),
        user: { ...options.user, id: decode(options.user.id) },
        excludeCredentials: options.excludeCredentials.map((credential) => ({
          id: decode(credential.id),
          type: credential.type,
          transports: credential.transports as
            | AuthenticatorTransport[]
            | undefined,
        })),
      },
    })) as PublicKeyCredential | null;
    if (!credential) throw new Error("Аутентификатор не вернул ответ.");
    const response = credential.response as AuthenticatorAttestationResponse;
    const publicKey = response.getPublicKey();
    return {
      id: credential.id,
      rawId: encode(credential.rawId),
      type: "public-key" as const,
      clientExtensionResults: { ...credential.getClientExtensionResults() },
      response: {
        clientDataJSON: encode(response.clientDataJSON),
        attestationObject: encode(response.attestationObject),
        transports: response.getTransports(),
        publicKeyAlgorithm: response.getPublicKeyAlgorithm(),
        ...(publicKey ? { publicKey: encode(publicKey) } : {}),
        authenticatorData: encode(response.getAuthenticatorData()),
      },
    };
  }, options);
}
