import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { parseSearchInput } from "@/application/regulations/schemas";
import { regulationsMessages } from "@/ui/i18n/dictionaries/regulations";
import { t } from "@/ui/i18n/translate";
import { RegulationsCatalog } from "@/ui/regulations/catalog";

it("ошибка поиска возвращает код, переведённый для обоих языков", () => {
  try {
    parseSearchInput({ query: "\u0000" });
    throw new Error("Ожидалась ошибка проверки запроса");
  } catch (error) {
    expect(error).toMatchObject({
      fieldErrors: { query: ["INVALID_REGULATION_QUERY"] },
    });
  }
  expect(t("ru", regulationsMessages, "INVALID_REGULATION_QUERY")).toContain(
    "от 1 до 200",
  );
  expect(t("en", regulationsMessages, "INVALID_REGULATION_QUERY")).toContain(
    "1–200 characters",
  );
});

it("English переводит каталог и ошибку, сохраняя название из БД", () => {
  const html = renderToStaticMarkup(
    createElement(RegulationsCatalog, {
      language: "en",
      documents: [
        { slug: "scholarship", title: "Стипендии", introduction: "Из БД" },
      ],
      results: [],
      validation: "INVALID_REGULATION_QUERY",
    }),
  );
  expect(html).toContain("Dean’s office regulations");
  expect(html).toContain("No matching sections");
  expect(html).toContain("Enter 1–200 characters without control characters.");
  expect(html).toContain(
    "Regulation titles and texts are available in Russian",
  );
  expect(html).toContain("Стипендии");
  expect(html).not.toContain("Поиск по положениям");
});

it("русский каталог сохраняет прежние подсказки и пустое состояние", () => {
  const html = renderToStaticMarkup(
    createElement(RegulationsCatalog, { language: "ru", documents: [] }),
  );
  expect(html).toContain("Положения пока не добавлены");
  expect(html).toContain("Поиск по положениям");
  expect(html).not.toContain("available in Russian");
});
