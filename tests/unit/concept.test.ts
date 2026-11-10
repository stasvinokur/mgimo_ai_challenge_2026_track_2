import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { concept } from "@/domain/shared/concept";
import { ConceptNotice, conceptNoticeText } from "@/ui/shell/concept-notice";

test("концепт сохраняет название и предупреждение о вымышленных данных", () => {
  expect(concept.name).toBe("Пульс");
  expect(concept.notice).toBe(
    "Конкурсный концепт MGIMO×AI Challenge. Не официальный сервис МГИМО. Все данные вымышлены",
  );
  expect(conceptNoticeText).toBe(concept.notice);
  const footer = renderToStaticMarkup(
    ConceptNotice({ children: concept.notice }),
  );
  expect(footer).toContain("<footer");
  expect(footer).toContain(concept.notice);
});
