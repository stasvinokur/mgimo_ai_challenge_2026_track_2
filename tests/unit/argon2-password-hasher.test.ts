import { expect, it } from "vitest";
import { Argon2PasswordHasher } from "../../src/infrastructure/auth/argon2-password-hasher";

it("argon2id проверяет пароль и использует случайную соль", async () => {
  const hasher = new Argon2PasswordHasher();
  const first = await hasher.hash("test-only-password");
  const second = await hasher.hash("test-only-password");
  expect(first.startsWith("$argon2id$v=19$")).toBe(true);
  expect(first).not.toBe(second);
  expect(await hasher.verify(first, "test-only-password")).toBe(true);
  expect(await hasher.verify(first, "other-password")).toBe(false);
});

it("некорректные и неподдерживаемые хэши не дают войти", async () => {
  const hasher = new Argon2PasswordHasher();
  for (const hash of ["plain-text", "$argon2id$invalid", "$argon2i$invalid"]) {
    expect(await hasher.verify(hash, "test-only-password")).toBe(false);
  }
});
