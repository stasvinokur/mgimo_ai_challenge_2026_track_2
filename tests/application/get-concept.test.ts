import { expect, test } from "vitest";
import { GetConcept } from "@/application/shared/get-concept";

test("публичный сценарий возвращает только сериализуемые сведения о концепте без БД", () => {
  const result = new GetConcept().execute();

  expect(Object.keys(result).sort()).toEqual(["name", "notice"]);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  expect(result.name).toBe("Пульс");
});
