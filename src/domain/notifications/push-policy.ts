export const PUSH_REQUEST_BODY =
  "Статус заявки изменился. Подробности — в кабинете.";
export const PUSH_TEST_BODY = "Уведомления включены. Это проверка доставки.";
export const PUSH_GENERIC_BODY = "В кабинете появилось новое уведомление.";

export function safePushBody(input: unknown): string {
  return input === PUSH_REQUEST_BODY || input === PUSH_TEST_BODY
    ? input
    : PUSH_GENERIC_BODY;
}
