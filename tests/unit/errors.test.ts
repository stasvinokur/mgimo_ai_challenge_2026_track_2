import { expect, it } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/domain/shared/errors";

it.each([
  new NotFoundError(),
  new ForbiddenError(),
  new ValidationError({ title: ["Заполните поле."] }),
  new ConflictError(),
  new RateLimitedError(),
])("доменные ошибки различимы и содержат русское сообщение: $name", (error) => {
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe(error.constructor.name);
  expect(error.message).toMatch(/[А-Яа-я]/);
});

it("валидация сохраняет несколько ошибок для каждого поля", () => {
  const fieldErrors = {
    title: ["Заполните поле.", "Укажите тему."],
    type: ["Выберите тип."],
  };
  expect(new ValidationError(fieldErrors).fieldErrors).toEqual(fieldErrors);
});
