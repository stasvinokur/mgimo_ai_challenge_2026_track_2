import type { Dictionary } from "@/ui/i18n/translate";

export const loginMessages = {
  pageTitle: { ru: "Вход", en: "Sign in" },
  title: { ru: "Вход в «Пульс»", en: "Sign in to Pulse" },
  description: {
    ru: "Учебные дела начинаются с вашего кабинета.",
    en: "Your student account brings your studies together.",
  },
  login: { ru: "Логин", en: "Username" },
  password: { ru: "Пароль", en: "Password" },
  submit: { ru: "Войти", en: "Sign in" },
  pending: { ru: "Входим…", en: "Signing in…" },
  passkey: { ru: "Войти с ключом доступа", en: "Sign in with a passkey" },
  passkeyError: {
    ru: "Не удалось войти с ключом доступа. Попробуйте снова или войдите по паролю.",
    en: "Could not sign in with a passkey. Please try again or use your password.",
  },
  demoHint: {
    ru: "Попробуйте вымышленные аккаунты. Кнопка заполнит поля, затем нажмите «Войти».",
    en: "Try a fictional account. Choose one to fill in the form, then select Sign in.",
  },
  demoAccount: { ru: "Войти как {name}", en: "Sign in as {name}" },
  invalidCredentials: {
    ru: "Неверный логин или пароль",
    en: "Incorrect username or password.",
  },
  invalidLogin: {
    ru: "Введите логин.",
    en: "Enter a username of up to 64 characters.",
  },
  invalidPassword: {
    ru: "Введите пароль.",
    en: "Enter a password of up to 1024 characters.",
  },
  invalidForm: {
    ru: "Проверьте поля формы.",
    en: "Please check the form and try again.",
  },
  rateLimited: {
    ru: "Слишком много попыток входа. Подождите 15 минут и попробуйте снова.",
    en: "Too many sign-in attempts. Please wait 15 minutes and try again.",
  },
  failed: {
    ru: "Не удалось выполнить действие. Попробуйте снова.",
    en: "Could not sign you in. Please try again.",
  },
} as const satisfies Dictionary;
