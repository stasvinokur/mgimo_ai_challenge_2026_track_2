import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import ProfilePage, { generateMetadata } from "@/app/(student)/profile/page";
import { identityMessages } from "@/ui/i18n/dictionaries/identity";
import { profileMessages } from "@/ui/i18n/dictionaries/profile";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";

const mocks = vi.hoisted(() => ({
  language: vi.fn(),
  requireStudent: vi.fn(),
  getProfile: vi.fn(),
}));
vi.mock("@/ui/i18n/server", () => ({ getLanguage: mocks.language }));
vi.mock("@/app/_lib/get-actor", () => ({
  requireStudent: mocks.requireStudent,
}));
vi.mock("@/app/_lib/map-errors", () => ({
  mapPageError: (error: unknown) => {
    throw error;
  },
}));
vi.mock("@/composition/container", () => ({
  student: { getMyProfile: { execute: mocks.getProfile } },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/profile" }));
vi.mock("@/ui/settings/settings-card", () => ({ SettingsCard: () => null }));
vi.mock("@/app/(auth)/logout-button", () => ({ LogoutButton: () => null }));

const actor = {
  kind: "student",
  userId: "profile-user",
  studentId: "profile-student",
  facultyId: "profile-faculty",
} as const;
const profile = {
  fullName: "Анна Соколова",
  faculty: "Вымышленный факультет",
  program: "Учебная программа",
  course: 2,
  group: "ДЕМО-2",
  recordBookNo: "DEMO-0001",
  scholarship: "academic",
};

beforeEach(() => {
  mocks.requireStudent.mockResolvedValue(actor);
  mocks.getProfile.mockResolvedValue(profile);
});

it.each(["ru", "en"] as const)(
  "профиль %s переводит подписи и карточки, сохраняя данные студента",
  async (language) => {
    mocks.language.mockResolvedValue(language);
    const page = await ProfilePage();
    const props = { language, children: page };
    const html = renderToStaticMarkup(createElement(LanguageProvider, props));
    expect(mocks.getProfile).toHaveBeenCalledWith(actor);
    expect(await generateMetadata()).toEqual({
      title: t(language, profileMessages, "title"),
    });
    for (const key of [
      "studentDetails",
      "fullName",
      "faculty",
      "program",
      "recordBookNo",
      "academic",
      "assistantJournal",
      "pushTitle",
      "pushLoading",
    ] as const)
      expect(html).toContain(t(language, profileMessages, key));
    expect(html).toContain(t(language, identityMessages, "passkeysTitle"));
    expect(html).toContain(t(language, identityMessages, "passkeysLoading"));
    expect(html).toContain("Анна Соколова");
    expect(html).toContain("Вымышленный факультет");
    expect(html).toContain("Учебная программа");
    expect(html).toContain("ДЕМО-2");
    expect(html).toContain("DEMO-0001");
  },
);

it("название ключа подставляется в перевод как данные, без транслитерации", () => {
  expect(
    t("en", identityMessages, "keyName", { name: "Учебный телефон" }),
  ).toBe("passkey “Учебный телефон”");
});
