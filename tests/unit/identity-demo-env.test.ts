import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { demoAccounts } from "@/application/identity/demo-accounts";
import { getEnv } from "@/infrastructure/config/env";

describe("Окружение публичного экрана входа", () => {
  it.each([undefined, "", "on", "off"])("переключатель %s", (value) => {
    vi.stubEnv("DEMO_LOGIN_HINTS", value);
    expect(getEnv("DEMO_LOGIN_HINTS")).toBe(value === "off" ? "off" : "on");
  });
  it.each(["OFF", "false", "0", " on", "off\n", "private-invalid-value"])(
    "неверный переключатель, вариант %#",
    (value) => {
      vi.stubEnv("DEMO_LOGIN_HINTS", value);
      expect(() => getEnv("DEMO_LOGIN_HINTS")).toThrow(
        /^Проверьте переменную окружения DEMO_LOGIN_HINTS\.$/,
      );
    },
  );
});

describe("Секрет демо-паролей", () => {
  it("отклоняет секрет целиком из паролей по умолчанию без вывода значений", () => {
    vi.stubEnv(
      "DEMO_ACCOUNT_PASSWORDS",
      demoAccounts
        .map((account) => `${account.login}:${account.password}`)
        .join(","),
    );
    expect(() => getEnv("DEMO_ACCOUNT_PASSWORDS")).toThrow(
      /^Проверьте переменную окружения DEMO_ACCOUNT_PASSWORDS\.$/,
    );
  });
  it.each(demoAccounts.map((account) => [account.login, account.password]))(
    "отклоняет публичный пароль аккаунта %s даже у другого логина",
    (_login, password) => {
      const secret = demoAccounts
        .map(
          (account) =>
            `${account.login}:${account.login === "anna" ? password : "x".repeat(20)}`,
        )
        .join(",");
      vi.stubEnv("DEMO_ACCOUNT_PASSWORDS", secret);
      expect(() => getEnv("DEMO_ACCOUNT_PASSWORDS")).toThrow(
        /^Проверьте переменную окружения DEMO_ACCOUNT_PASSWORDS\.$/,
      );
    },
  );
  const entries = ["anna", "timur", "marina", "oleg"].map(
    (login, i) => `${login}:${String(i).repeat(20)}`,
  );
  it.each([undefined, ""])("без секрета — прежний сид, вариант %#", (value) => {
    vi.stubEnv("DEMO_ACCOUNT_PASSWORDS", value);
    expect(getEnv("DEMO_ACCOUNT_PASSWORDS")).toBeUndefined();
  });
  it("принимает все четыре логина в любом порядке и пароль от 12 символов", () => {
    vi.stubEnv("DEMO_ACCOUNT_PASSWORDS", entries.toReversed().join(","));
    expect(Object.keys(getEnv("DEMO_ACCOUNT_PASSWORDS") ?? {}).sort()).toEqual([
      "anna",
      "marina",
      "oleg",
      "timur",
    ]);
    vi.stubEnv(
      "DEMO_ACCOUNT_PASSWORDS",
      entries.join(",").replace("0".repeat(20), "x".repeat(12)),
    );
    expect(getEnv("DEMO_ACCOUNT_PASSWORDS")?.anna).toHaveLength(12);
  });
  const invalid = [
    entries.slice(1).join(","),
    [...entries, entries[0]].join(","),
    [entries[0], entries[1], entries[2], entries[0]].join(","),
    entries.join(",").replace("oleg:", "unknown:"),
    entries.join(",").replace("anna:", "Anna:"),
    entries.join(",").replace("0".repeat(20), "x".repeat(11)),
    entries.join(",").replace("0".repeat(20), ""),
    entries.join(",").replace("0".repeat(20), "private,invalid-password"),
    entries.join(",").replace("0".repeat(20), "private:invalid-password"),
    ...[" ", "\t", "\n", "\r", "\u00a0"].map((space) =>
      entries
        .join(",")
        .replace("0".repeat(20), `private${space}invalid-password`),
    ),
    `${entries.join(",")}\n`,
    entries.join(",").replace("anna:", "anna"),
    ` ${entries.join(",")}`,
    `${entries.join(",")},`,
  ];
  it.each(invalid)(
    "отклоняет неверный секрет без его вывода, вариант %#",
    (value) => {
      vi.stubEnv("DEMO_ACCOUNT_PASSWORDS", value);
      expect(() => getEnv("DEMO_ACCOUNT_PASSWORDS")).toThrow(
        /^Проверьте переменную окружения DEMO_ACCOUNT_PASSWORDS\.$/,
      );
    },
  );
  it("команда сида завершается до подключения к БД и выводит только имя переменной", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/seed.ts"],
      {
        env: {
          ...process.env,
          DATABASE_URL: "postgres://test:test@127.0.0.1:1/invalid_test",
          DEMO_ACCOUNT_PASSWORDS: "private-invalid-test-secret",
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe(
      "Проверьте переменную окружения DEMO_ACCOUNT_PASSWORDS.",
    );
  });
  it("compose передаёт каждую настройку только нужному сервису", () => {
    const compose = readFileSync("compose.yaml", "utf8");
    const services = compose.split(/(?=^ {2}[a-z]+:\n)/m);
    expect(
      services.filter((service) => service.includes("DEMO_ACCOUNT_PASSWORDS")),
    ).toHaveLength(1);
    expect(
      services.find((service) => service.includes("DEMO_ACCOUNT_PASSWORDS")),
    ).toMatch(/^ {2}migrate:/);
    expect(
      services.filter((service) => service.includes("DEMO_LOGIN_HINTS")),
    ).toHaveLength(1);
    expect(
      services.find((service) => service.includes("DEMO_LOGIN_HINTS")),
    ).toMatch(/^ {2}app:/);
  });
});
