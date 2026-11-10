import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { LogoutButton } from "@/app/(auth)/logout-button";
import type { Language } from "@/ui/i18n/language";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { Sheet, SheetContent, SheetTitle } from "@/ui/primitives/sheet";

const state = vi.hoisted(() => ({ pending: false }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useActionState: () => [{}, "/logout-test", state.pending],
}));
vi.mock("@/app/(auth)/actions", () => ({ logout: vi.fn() }));
vi.mock("radix-ui", async (original) => {
  const radix = await original<typeof import("radix-ui")>();
  return {
    ...radix,
    Dialog: {
      ...radix.Dialog,
      Portal: ({ children }: { children: React.ReactNode }) =>
        createElement(Fragment, null, children),
    },
  };
});

function render(language: Language, children: React.ReactNode) {
  return renderToStaticMarkup(
    createElement(LanguageProvider, { language, children }),
  );
}

beforeEach(() => {
  state.pending = false;
});

it.each([
  [false, "Sign out", "Выйти"],
  [true, "Signing out…", "Выходим…"],
] as const)(
  "выход переводится явно, а служебные кабинеты сохраняют русский (pending=%s)",
  (pending, english, russian) => {
    state.pending = pending;
    const student = render(
      "en",
      createElement<{ language?: Language }>(LogoutButton, { language: "en" }),
    );
    expect(student).toContain(`>${english}</button>`);
    expect(student).not.toMatch(/[\p{Script=Cyrillic}]/u);
    const staff = render(
      "en",
      createElement<{ language?: Language }>(LogoutButton, { language: "ru" }),
    );
    expect(staff).toContain(`>${russian}</button>`);
    expect(render("ru", createElement(LogoutButton))).toContain(
      `>${russian}</button>`,
    );
    expect(student.includes('disabled=""')).toBe(pending);
    expect(staff.includes('disabled=""')).toBe(pending);
  },
);

it.each([
  ["en", "Close"],
  ["ru", "Закрыть"],
] as const)(
  "шторка %s получает скрытую подпись из языка UI",
  (language, label) => {
    const html = render(
      language,
      createElement(
        Sheet,
        { open: true },
        createElement(
          SheetContent,
          { "aria-describedby": undefined },
          createElement(SheetTitle, null, "Test"),
        ),
      ),
    );
    expect(html).toContain(`<span class="sr-only">${label}</span>`);
  },
);

it("русская шторка сотрудника использует язык вложенной оболочки при cookie en", () => {
  const russianProps = {
    language: "ru" as const,
    children: createElement(
      Sheet,
      { open: true },
      createElement(
        SheetContent,
        { "aria-describedby": undefined },
        createElement(SheetTitle, null, "Test"),
      ),
    ),
  };
  const html = render("en", createElement(LanguageProvider, russianProps));
  expect(html).toContain('<span class="sr-only">Закрыть</span>');
  expect(html).not.toContain('class="sr-only">Close<');
});
