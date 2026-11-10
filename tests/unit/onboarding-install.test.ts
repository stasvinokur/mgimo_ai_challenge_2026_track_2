import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import Page, { generateMetadata } from "@/app/(student)/today/install/page";

const mocks = vi.hoisted(() => ({
  requireStudent: vi.fn(),
  getLanguage: vi.fn(),
}));

vi.mock("@/app/_lib/get-actor", () => ({
  requireStudent: mocks.requireStudent,
}));
vi.mock("@/ui/i18n/server", () => ({
  getLanguage: mocks.getLanguage,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireStudent.mockResolvedValue({ kind: "student" });
});

it.each([
  {
    language: "ru",
    title: "Установка на телефон",
    heading: "Установить «Пульс» на телефон",
    prompt: "Подсказка установки появится над этой страницей",
    help: "откройте меню браузера",
    back: "К первым шагам",
  },
  {
    language: "en",
    title: "Install on your phone",
    heading: "Install Pulse on your phone",
    prompt: "An installation prompt will appear above this page",
    help: "open your browser menu",
    back: "Back to first steps",
  },
])(
  "страница установки использует серверный язык $language и проверяет роль",
  async ({ language, title, heading, prompt, help, back }) => {
    mocks.getLanguage.mockResolvedValue(language);
    expect(await generateMetadata()).toEqual({ title });
    expect(mocks.requireStudent).toHaveBeenCalledOnce();
    mocks.requireStudent.mockClear();
    const html = renderToStaticMarkup(await Page());
    expect(mocks.requireStudent).toHaveBeenCalledOnce();
    for (const text of [heading, prompt, help, back])
      expect(html).toContain(text);
    expect(html).toContain('href="/today"');
    if (language === "en") expect(html).not.toMatch(/[А-Яа-яЁё]/);
  },
);

it.each([Page, generateMetadata])(
  "отказ в доступе не читает язык и не выдаёт страницу: %s",
  async (handler) => {
    const error = new Error("STUDENT_REQUIRED");
    mocks.requireStudent.mockRejectedValue(error);
    await expect(handler()).rejects.toBe(error);
    expect(mocks.getLanguage).not.toHaveBeenCalled();
  },
);
