import { expect, it, vi } from "vitest";
import { generateMetadata } from "@/app/layout";

const request = vi.hoisted(() => ({
  language: undefined as string | undefined,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: request.language }) }),
}));

it.each(["en", "ru", undefined, "unknown"])(
  "корневые метаданные следуют закрытому языку cookie %s",
  async (language) => {
    request.language = language;
    const metadata = await generateMetadata();
    const english = language === "en";
    const brand = english ? "Pulse" : "Пульс";
    expect(metadata.title).toEqual({
      default: english
        ? "Pulse — digital student office"
        : "Пульс — цифровой деканат",
      template: `%s · ${brand}`,
    });
    expect(metadata.applicationName).toBe(brand);
    expect(metadata.appleWebApp).toEqual({
      capable: true,
      title: brand,
      statusBarStyle: "default",
    });
    expect(metadata.description).toBe(
      english
        ? "MGIMO×AI Challenge digital student office competition concept. All data is fictional."
        : "Конкурсный концепт цифрового деканата MGIMO×AI Challenge. Все данные вымышлены.",
    );
    if (english)
      expect(JSON.stringify(metadata)).not.toMatch(/[\p{Script=Cyrillic}]/u);
    expect(metadata.icons).toEqual({
      icon: "/favicon.svg",
      apple: "/icons/apple-touch-icon.png",
    });
    expect(metadata.manifest).toBe("/manifest.webmanifest");
  },
);
