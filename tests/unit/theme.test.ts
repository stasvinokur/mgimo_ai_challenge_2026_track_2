import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  themeScript,
  toggleTheme,
  watchTheme,
} from "@/ui/shell/theme";

function fakeBrowser(savedTheme: string | null, systemDark: boolean) {
  const values = new Map<string, string>();
  if (savedTheme !== null) values.set("pulse-theme", savedTheme);
  const localStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
  const classes = new Set(["a11y-high-contrast", "a11y-large-text"]);
  const root = {
    classList: {
      add: (...names: string[]) => {
        for (const name of names) classes.add(name);
      },
      remove: (...names: string[]) => {
        for (const name of names) classes.delete(name);
      },
      contains: (name: string) => classes.has(name),
    },
    style: { colorScheme: "" },
  };
  const media = Object.assign(new EventTarget(), { matches: systemDark });
  const window = Object.assign(new EventTarget(), {
    localStorage,
    matchMedia: vi.fn((query: string) => {
      expect(query).toBe("(prefers-color-scheme: dark)");
      return media;
    }),
  });
  const document = { documentElement: root };
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  return {
    window,
    document,
    localStorage,
    classes,
    values,
    changeSystem(dark: boolean) {
      media.matches = dark;
      media.dispatchEvent(new Event("change"));
    },
    changeStorage(
      value: string | null,
      key: string | null = "pulse-theme",
      storageArea: unknown = localStorage,
    ) {
      if (key === null) values.clear();
      else if (value === null) values.delete(key);
      else values.set(key, value);
      window.dispatchEvent(
        Object.assign(new Event("storage"), {
          key,
          newValue: value,
          storageArea,
        }),
      );
    },
    expectTheme(theme: "light" | "dark") {
      expect([...classes].sort()).toEqual(
        ["a11y-high-contrast", "a11y-large-text", theme].sort(),
      );
      expect(root.style.colorScheme).toBe(theme);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("ранний скрипт темы", () => {
  it.each([
    { saved: "dark", systemDark: false, expected: "dark" },
    { saved: "light", systemDark: true, expected: "light" },
    { saved: "dark", systemDark: true, expected: "dark" },
    { saved: "light", systemDark: false, expected: "light" },
    { saved: null, systemDark: false, expected: "light" },
    { saved: null, systemDark: true, expected: "dark" },
    { saved: "system", systemDark: false, expected: "light" },
    { saved: "system", systemDark: true, expected: "dark" },
  ] as const)(
    "$saved при systemDark=$systemDark применяется до гидрации",
    ({ saved, systemDark, expected }) => {
      const browser = fakeBrowser(saved, systemDark);
      browser.classes.add(expected === "dark" ? "light" : "dark");
      runInNewContext(themeScript, {
        window: browser.window,
        document: browser.document,
        console,
      });
      browser.expectTheme(expected);
      expect(browser.localStorage.setItem).not.toHaveBeenCalled();
    },
  );

  it.each(["DARK", " light", "", "__proto__", 'dark" class="injected'])(
    "неизвестное значение %s не попадает в HTML",
    (saved) => {
      const browser = fakeBrowser(saved, true);
      runInNewContext(themeScript, {
        window: browser.window,
        document: browser.document,
        console,
      });
      browser.expectTheme("dark");
    },
  );

  it("при запрете localStorage выбирает системную тему и фиксированный код ошибки", () => {
    const browser = fakeBrowser("light", true);
    browser.localStorage.getItem.mockImplementation(() => {
      throw new Error("Доступ к хранилищу запрещён");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    runInNewContext(themeScript, {
      window: browser.window,
      document: browser.document,
      console,
    });
    browser.expectTheme("dark");
    expect(warn).toHaveBeenCalledExactlyOnceWith("THEME_STORAGE_READ_FAILED");
  });
});

describe("переключение и наблюдение за темой", () => {
  it.each([
    { saved: "dark", systemDark: false, initial: "dark", next: "light" },
    { saved: "light", systemDark: true, initial: "light", next: "dark" },
  ] as const)(
    "монтирование сохраняет $saved независимо от системы, переключатель запоминает выбор",
    ({ saved, systemDark, initial, next }) => {
      const browser = fakeBrowser(saved, systemDark);
      applyTheme();
      const changes = vi.fn();
      const cleanup = watchTheme(changes);
      browser.expectTheme(initial);
      expect(changes).toHaveBeenLastCalledWith(initial);
      toggleTheme();
      browser.expectTheme(next);
      expect(browser.localStorage.setItem).toHaveBeenLastCalledWith(
        "pulse-theme",
        next,
      );
      expect(changes).toHaveBeenLastCalledWith(next);
      toggleTheme();
      browser.expectTheme(initial);
      expect(browser.values.get("pulse-theme")).toBe(initial);
      cleanup();
    },
  );

  it.each([null, "system"])(
    "без явного выбора (%s) реагирует на смену системной темы",
    (saved) => {
      const browser = fakeBrowser(saved, false);
      const changes = vi.fn();
      const cleanup = watchTheme(changes);
      browser.expectTheme("light");
      browser.changeSystem(true);
      browser.expectTheme("dark");
      browser.changeSystem(false);
      browser.expectTheme("light");
      expect(changes.mock.calls.map(([theme]) => theme)).toEqual([
        "light",
        "dark",
        "light",
      ]);
      expect(browser.localStorage.setItem).not.toHaveBeenCalled();
      cleanup();
    },
  );

  it.each(["light", "dark"] as const)(
    "системная тема не переопределяет сохранённую %s",
    (saved) => {
      const browser = fakeBrowser(saved, false);
      const cleanup = watchTheme(vi.fn());
      browser.changeSystem(true);
      browser.expectTheme(saved);
      browser.changeSystem(false);
      browser.expectTheme(saved);
      cleanup();
    },
  );

  it("явный выбор после монтирования прекращает следование системе", () => {
    const browser = fakeBrowser(null, false);
    const cleanup = watchTheme(vi.fn());
    toggleTheme();
    browser.expectTheme("dark");
    browser.changeSystem(true);
    browser.changeSystem(false);
    browser.expectTheme("dark");
    cleanup();
  });

  it("выбор в другой вкладке синхронизирует тему и может вернуть системный режим", () => {
    const browser = fakeBrowser("light", false);
    const cleanup = watchTheme(vi.fn());
    browser.changeStorage("dark");
    browser.expectTheme("dark");
    browser.changeSystem(true);
    browser.changeStorage("light");
    browser.expectTheme("light");
    browser.changeStorage("system");
    browser.expectTheme("dark");
    browser.changeSystem(false);
    browser.expectTheme("light");
    cleanup();
  });

  it.each(["pulse-theme", null])(
    "удаление темы или очистка хранилища (%s) возвращает системный режим",
    (key) => {
      const browser = fakeBrowser("light", true);
      const cleanup = watchTheme(vi.fn());
      browser.changeStorage(null, key);
      browser.expectTheme("dark");
      browser.changeSystem(false);
      browser.expectTheme("light");
      cleanup();
    },
  );

  it("чужой ключ и sessionStorage не меняют тему", () => {
    const browser = fakeBrowser("dark", false);
    const changes = vi.fn();
    const cleanup = watchTheme(changes);
    changes.mockClear();
    browser.changeStorage("light", "unrelated");
    browser.changeStorage("light", "pulse-theme", {});
    browser.expectTheme("dark");
    expect(changes).not.toHaveBeenCalled();
    cleanup();
  });

  it("cleanup снимает все подписки", () => {
    const browser = fakeBrowser("light", false);
    const changes = vi.fn();
    const cleanup = watchTheme(changes);
    cleanup();
    changes.mockClear();
    browser.changeSystem(true);
    browser.changeStorage("dark");
    browser.window.dispatchEvent(
      new CustomEvent("pulse:theme-change", { detail: "dark" }),
    );
    browser.expectTheme("light");
    expect(changes).not.toHaveBeenCalled();
  });

  it("запрет записи не мешает переключению и выбору до конца текущей страницы", () => {
    const browser = fakeBrowser(null, false);
    browser.localStorage.setItem.mockImplementation(() => {
      throw new Error("Доступ к хранилищу запрещён");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cleanup = watchTheme(vi.fn());
    toggleTheme();
    browser.expectTheme("dark");
    browser.changeSystem(true);
    browser.changeSystem(false);
    browser.expectTheme("dark");
    expect(warn).toHaveBeenCalledExactlyOnceWith("THEME_STORAGE_WRITE_FAILED");
    cleanup();
  });
});
