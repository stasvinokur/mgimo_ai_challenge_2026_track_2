import { expect, test } from "vitest";
import {
  GetConcept,
  getConceptMessage,
} from "@/application/shared/get-concept";

test("DTO оболочки передаёт только коды сообщений без готового текста", () => {
  const dto = getConceptMessage();
  expect(dto).toEqual({ name: "brandName", notice: "competitionConcept" });
  expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  expect(JSON.stringify(dto)).not.toMatch(/[А-Яа-яЁё]/);
});

test("публичная проверка справки сохраняет прежнее русское представление", () => {
  const dto = new GetConcept().execute();
  expect(dto.name).toBe("Пульс");
  expect(dto.notice).toBe(
    "Конкурсный концепт MGIMO×AI Challenge. Не официальный сервис МГИМО. Все данные вымышлены",
  );
});
