import type { Language } from "./language";

export type Dictionary = Record<string, Record<Language, string>>;

export function t<D extends Dictionary>(
  language: Language,
  dictionary: D,
  key: keyof D & string,
  params: Record<string, string | number> = {},
): string {
  const message = dictionary[key]?.[language];
  if (message === undefined) throw new Error("Неизвестный ключ перевода");
  return message.replace(/\{(\w+)\}/g, (_match, name: string) => {
    if (!Object.hasOwn(params, name))
      throw new Error("Не указан параметр перевода");
    return String(params[name]);
  });
}
