import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getConceptMessage } from "@/application/shared/get-concept";
import { shellMessages } from "@/ui/i18n/dictionaries/shell";
import { formatDate, formatNumber } from "@/ui/i18n/format";
import {
  LANGUAGE_COOKIE,
  languageCookie,
  parseLanguage,
} from "@/ui/i18n/language";
import {
  LanguageProvider,
  useDeviceLanguage,
  useLanguage,
} from "@/ui/i18n/language-provider";
import { LanguageSelect } from "@/ui/i18n/language-select";
import { type Dictionary, t } from "@/ui/i18n/translate";

function LanguageProbe() {
  const language = useLanguage();
  return createElement("span", { lang: language }, language);
}

function DeviceLanguageProbe() {
  return createElement("span", {
    "data-rendered": useLanguage(),
    "data-device": useDeviceLanguage(),
  });
}

describe("язык устройства", () => {
  it("по умолчанию выбирается русский независимо от языка браузера", () => {
    expect(LANGUAGE_COOKIE).toBe("pulse-language");
    expect(parseLanguage(undefined)).toBe("ru");
    expect(parseLanguage("ru")).toBe("ru");
    expect(parseLanguage("en")).toBe("en");
  });

  it.each([
    null,
    "",
    "EN",
    "en-US",
    "en ",
    " en",
    "english",
    "en%20",
    "__proto__",
    "constructor",
    'en" lang="en',
    "en; Path=/",
    { language: "en" },
  ])("неизвестное значение %j игнорируется", (value) => {
    expect(parseLanguage(value)).toBe("ru");
  });

  it("cookie ограничена языком, общим путём и годом хранения", () => {
    for (const language of ["ru", "en"] as const) {
      for (const secure of [false, true]) {
        expect(languageCookie(language, secure)).toBe(
          `pulse-language=${language}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`,
        );
      }
    }
  });

  it("первый серверный и клиентский рендер получают одинаковый язык", () => {
    for (const language of ["ru", "en"] as const) {
      const props = { language, children: createElement(LanguageProbe) };
      expect(renderToStaticMarkup(createElement(LanguageProvider, props))).toBe(
        `<span lang="${language}">${language}</span>`,
      );
    }
  });

  it.each(["ru", "en"] as const)(
    "до гидратации селектор %s показывает серверный язык и блокирует выбор",
    (language) => {
      const props = { language, children: createElement(LanguageSelect) };
      const html = renderToStaticMarkup(createElement(LanguageProvider, props));
      const select = html.match(/<select\b[^>]*>/)?.[0];
      expect(select).toContain('disabled=""');
      expect(select).toContain('data-language-ready="false"');
      expect(html).toContain(
        `value="${language}" lang="${language}" selected=""`,
      );
    },
  );

  it("русский кабинет сотрудника сохраняет выбранный English в настройке устройства", () => {
    const localProps = {
      language: "ru" as const,
      children: [
        createElement(DeviceLanguageProbe, { key: "probe" }),
        createElement(LanguageSelect, { key: "select" }),
      ],
    };
    const props = {
      language: "en" as const,
      children: createElement(LanguageProvider, localProps),
    };
    const html = renderToStaticMarkup(createElement(LanguageProvider, props));
    expect(html).toContain('data-rendered="ru" data-device="en"');
    expect(html).toContain('value="en" lang="en" selected=""');
    expect(html).toContain(">Language</label>");
  });
});

describe("независимые словари", () => {
  it("каждый модуль и ключ содержат непустые русскую и английскую строки", async () => {
    const directory = new URL(
      "../../src/ui/i18n/dictionaries/",
      import.meta.url,
    );
    const files = readdirSync(directory, {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => join(entry.parentPath, entry.name));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) {
      const module: Record<string, Dictionary> = await import(
        pathToFileURL(file).href
      );
      expect(Object.keys(module).length, file).toBeGreaterThan(0);
      for (const dictionary of Object.values(module)) {
        expect(Object.keys(dictionary).length, file).toBeGreaterThan(0);
        for (const [key, message] of Object.entries(dictionary)) {
          expect(Object.keys(message).sort(), `${file}: ${key}`).toEqual([
            "en",
            "ru",
          ]);
          for (const language of ["ru", "en"] as const) {
            expect(typeof message[language], `${file}: ${key}`).toBe("string");
            expect(
              message[language].trim().length,
              `${file}: ${key}`,
            ).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("t переводит текст и подставляет значения без обработки HTML", () => {
    const dictionary = {
      greeting: {
        ru: "Здравствуйте, {name}. Балл: {score}",
        en: "Hello, {name}. Score: {score}",
      },
    } as const satisfies Dictionary;
    expect(t("ru", dictionary, "greeting", { name: "Анна", score: 86 })).toBe(
      "Здравствуйте, Анна. Балл: 86",
    );
    expect(t("en", dictionary, "greeting", { name: "<Anna>", score: 86 })).toBe(
      "Hello, <Anna>. Score: 86",
    );
    expect(() => t("en", dictionary, "greeting")).toThrow();
  });

  it("кодовое DTO переводится в UI без зависимости application от словарей", () => {
    const dto = getConceptMessage();
    expect(t("ru", shellMessages, dto.name)).toBe("Пульс");
    expect(t("en", shellMessages, dto.name)).toBe("Pulse");
    expect(t("ru", shellMessages, dto.notice)).toContain(
      "Все данные вымышлены",
    );
    expect(t("en", shellMessages, dto.notice)).not.toMatch(/[А-Яа-яЁё]/);
  });
});

describe("форматирование для выбранного языка", () => {
  it.each(["ru", "en"] as const)(
    "дата %s всегда отражает московский день",
    (language) => {
      const date = "2026-11-04T22:30:00.000Z";
      const options = {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      } as const;
      expect(formatDate(language, date, options)).toBe(
        new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", {
          ...options,
          timeZone: "Europe/Moscow",
        }).format(new Date(date)),
      );
      expect(formatDate(language, new Date(date), options)).toBe(
        formatDate(language, date, options),
      );
    },
  );

  it("переданный часовой пояс не меняет московское отображение", () => {
    const options = { hour: "2-digit", minute: "2-digit" } as const;
    expect(
      formatDate("en", "2026-11-04T22:30:00Z", { ...options, timeZone: "UTC" }),
    ).toBe(formatDate("en", "2026-11-04T22:30:00Z", options));
  });

  it.each(["ru", "en"] as const)(
    "числа %s используют выбранный язык",
    (language) => {
      expect(formatNumber(language, 1234.5, { maximumFractionDigits: 1 })).toBe(
        new Intl.NumberFormat(language === "ru" ? "ru-RU" : "en-GB", {
          maximumFractionDigits: 1,
        }).format(1234.5),
      );
    },
  );
});
