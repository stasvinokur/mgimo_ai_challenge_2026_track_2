import type { Dictionary } from "@/ui/i18n/translate";

export const regulationsMessages = {
  catalogTitle: { ru: "Положения деканата", en: "Dean’s office regulations" },
  documentTitle: { ru: "Положение деканата", en: "Dean’s office regulation" },
  introduction: {
    ru: "Правила, на которые ссылаются подсказки и ассистент. Все положения вымышлены и созданы для конкурсного концепта.",
    en: "Rules referenced by tips and the assistant. All regulations are fictional and were created for this competition concept.",
  },
  russianContent: {
    ru: "Тексты положений доступны на русском языке.",
    en: "Regulation titles and texts are available in Russian. Search using Russian words.",
  },
  searchLabel: { ru: "Поиск по положениям", en: "Search regulations" },
  searchPlaceholder: {
    ru: "Например, повышенная стипендия",
    en: "For example: повышенная стипендия",
  },
  search: { ru: "Найти", en: "Search" },
  searchHint: {
    ru: "До 200 символов. Поиск покажет до пяти подходящих пунктов.",
    en: "Up to 200 characters. Search returns up to five matching sections.",
  },
  INVALID_REGULATION_QUERY: {
    ru: "Введите запрос от 1 до 200 символов без управляющих символов.",
    en: "Enter 1–200 characters without control characters.",
  },
  results: { ru: "Результаты поиска", en: "Search results" },
  noMatches: {
    ru: "Подходящих пунктов не найдено",
    en: "No matching sections",
  },
  noMatchesHint: {
    ru: "Попробуйте другие слова или задайте вопрос в деканат — сотрудник поможет разобраться.",
    en: "Try different words or ask the dean’s office for help.",
  },
  question: { ru: "Вопрос в деканат", en: "Ask the dean’s office" },
  all: { ru: "Все положения", en: "All regulations" },
  empty: { ru: "Положения пока не добавлены", en: "No regulations yet" },
  emptyHint: {
    ru: "Задайте вопрос в деканат, если нужна помощь с учебным вопросом.",
    en: "Ask the dean’s office if you need help with an academic question.",
  },
  back: { ru: "← Все положения и поиск", en: "← All regulations and search" },
  sections: { ru: "Пункты положения", en: "Regulation sections" },
  goToSection: { ru: "К пункту § {section}", en: "Go to § {section}" },
  copy: {
    ru: "Скопировать ссылку на пункт {section}",
    en: "Copy link to section {section}",
  },
  copied: { ru: "Ссылка на пункт скопирована", en: "Section link copied" },
  copyManually: {
    ru: "Скопируйте ссылку вручную",
    en: "Copy the link manually",
  },
  loadingLabel: { ru: "Загрузка положений", en: "Loading regulations" },
  loading: { ru: "Загружаем положения…", en: "Loading regulations…" },
} as const satisfies Dictionary;
