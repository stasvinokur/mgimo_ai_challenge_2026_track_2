import type { Dictionary } from "@/ui/i18n/translate";

export const identityMessages = {
  signOut: { ru: "Выйти", en: "Sign out" },
  signingOut: { ru: "Выходим…", en: "Signing out…" },
  passkeysTitle: { ru: "Ключи доступа", en: "Passkeys" },
  passkeysDescription: {
    ru: "Вход по отпечатку пальца, Face ID или коду устройства. Пароль остаётся доступен.",
    en: "Sign in with a fingerprint, Face ID or device PIN. You can still use your password.",
  },
  passkeysLoading: { ru: "Загружаем ключи доступа…", en: "Loading passkeys…" },
  passkeysLoadFailed: {
    ru: "Не удалось загрузить ключи доступа.",
    en: "Could not load passkeys.",
  },
  retry: { ru: "Повторить", en: "Try again" },
  created: { ru: "Создан:", en: "Created:" },
  lastUsed: { ru: "Последний вход:", en: "Last sign-in:" },
  neverUsed: { ru: "Ещё не использовался", en: "Not used yet" },
  remove: { ru: "Удалить", en: "Remove" },
  keyName: { ru: "ключ «{name}»", en: "passkey “{name}”" },
  passkeysEmpty: {
    ru: "Ключей доступа пока нет. Добавьте ключ этого устройства, чтобы входить без пароля.",
    en: "You have no passkeys yet. Add a passkey for this device to sign in without a password.",
  },
  deviceName: { ru: "Название устройства", en: "Device name" },
  demoPasskeyNotice: {
    ru: "На общем демо-аккаунте ключ получает имя автоматически. Ключи и подписки старше 24 часов удаляются при обновлении демо.",
    en: "Passkeys on this shared demo account are named automatically. Passkeys and subscriptions older than 24 hours are removed when the demo is refreshed.",
  },
  demoPasskeyName: { ru: "Ключ демо-аккаунта", en: "Demo account passkey" },
  demoPasskeyRemovalNotice: {
    ru: "Ключи общего демо-аккаунта нельзя удалить вручную: ими пользуются другие посетители. Ключ удалится при обновлении демо, когда ему будет больше суток, или при вытеснении самого старого ключа новым.",
    en: "Passkeys on this shared demo account cannot be removed manually because other visitors use them. A passkey is removed when the demo is refreshed once it is more than 24 hours old, or when a new passkey replaces the oldest one.",
  },
  deviceNamePlaceholder: {
    ru: "Например, мой телефон",
    en: "For example, my phone",
  },
  wait: { ru: "Подождите…", en: "Please wait…" },
  addKey: { ru: "Добавить ключ", en: "Add passkey" },
  passkeysUnsupported: {
    ru: "Для добавления ключа нужен браузер с поддержкой ключей доступа и защищённое соединение.",
    en: "To add a passkey, use a browser that supports passkeys and a secure connection.",
  },
  reauthenticationRequired: {
    ru: "Чтобы добавить ключ доступа, войдите заново",
    en: "Sign in again to add a passkey",
  },
  signInAgain: { ru: "Войти заново", en: "Sign in again" },
  passkeyAdded: { ru: "Ключ доступа добавлен.", en: "Passkey added." },
  passkeyRemoved: {
    ru: "Ключ доступа удалён. Вход по паролю остаётся доступен.",
    en: "Passkey removed. You can still sign in with your password.",
  },
  passkeyAddFailed: {
    ru: "Не удалось добавить ключ доступа. Попробуйте снова.",
    en: "Could not add the passkey. Try again.",
  },
  passkeyRemoveFailed: {
    ru: "Не удалось удалить ключ доступа. Попробуйте снова.",
    en: "Could not remove the passkey. Try again.",
  },
  passkeyLimitReached: {
    ru: "Можно добавить не больше 10 ключей доступа. Удалите ненужный ключ и попробуйте снова.",
    en: "You can add up to 10 passkeys. Remove an unused passkey and try again.",
  },
  passkeyRegistrationRateLimited: {
    ru: "Можно добавить не больше 3 ключей доступа за 15 минут. Попробуйте позже.",
    en: "You can add up to 3 passkeys in 15 minutes. Please try again later.",
  },
  moscowTime: { ru: "МСК", en: "MSK" },
} as const satisfies Dictionary;
