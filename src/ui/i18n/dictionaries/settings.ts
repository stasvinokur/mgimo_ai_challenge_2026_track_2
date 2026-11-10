import type { Dictionary } from "@/ui/i18n/translate";

export const settingsMessages = {
  title: { ru: "Настройки", en: "Settings" },
  description: {
    ru: "Сохраняются в этом браузере и действуют во всех разделах, в том числе на странице входа. Тему можно переключить кнопкой вверху страницы.",
    en: "Saved in this browser and used across all sections, including sign-in. Use the button at the top of the page to change the theme.",
  },
  largeText: { ru: "Крупный текст", en: "Larger text" },
  largeTextDescription: {
    ru: "Текст и элементы интерфейса на 25% крупнее.",
    en: "Text and controls are 25% larger.",
  },
  highContrast: { ru: "Высокий контраст", en: "High contrast" },
  highContrastDescription: {
    ru: "Более чёткие цвета текста, границ и элементов управления.",
    en: "Stronger colours for text, borders and controls.",
  },
  reducedMotion: { ru: "Меньше движения", en: "Less motion" },
  reducedMotionDescription: {
    ru: "Без анимаций и плавных переходов.",
    en: "Turn off animations and smooth transitions.",
  },
} as const satisfies Dictionary;
