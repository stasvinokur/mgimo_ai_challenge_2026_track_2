import { expect, it } from "vitest";
import {
  parsePushEndpoint,
  parsePushSubscription,
} from "@/application/notifications/push/schemas";
import { ValidationError } from "@/application/shared/errors";
import {
  isCanonicalPushEndpoint,
  isTrustedPushEndpoint,
} from "@/domain/notifications/push-subscription-policy";

const keys = { p256dh: `B${"a".repeat(86)}`, auth: "a".repeat(22) };

it.each([
  "https:fcm.googleapis.com/fcm/send/test",
  "https:/fcm.googleapis.com/fcm/send/test",
  "https://fcm.googleapis.com:443/fcm/send/test",
  "https://FCM.googleapis.com/fcm/send/test",
  "HTTPS://fcm.googleapis.com/fcm/send/test",
  "https://fcm.googleapis.com/fcm/../send/test",
  "https://fcm.googleapis.com/fcm/send/тест",
  "https://fcm.googleapis.com/fcm/send/test\n",
])("отклоняет неканонический endpoint без нормализации: %s", (endpoint) => {
  expect(isCanonicalPushEndpoint(endpoint)).toBe(false);
  expect(isTrustedPushEndpoint(endpoint)).toBe(false);
  expect(() => parsePushEndpoint({ endpoint })).toThrow(ValidationError);
  expect(() => parsePushSubscription({ endpoint, keys })).toThrow(
    ValidationError,
  );
});

it.each([
  "https://fcm.googleapis.com/fcm/send/test",
  "https://updates.push.services.mozilla.com/wpush/v2/test",
  "https://web.push.apple.com/test",
  "https://wns2.notify.windows.com/test",
])("сохраняет канонический endpoint службы без изменений: %s", (endpoint) => {
  expect(isCanonicalPushEndpoint(endpoint)).toBe(true);
  expect(isTrustedPushEndpoint(endpoint)).toBe(true);
  expect(parsePushSubscription({ endpoint, keys })).toEqual({ endpoint, keys });
});

it("канонический адрес вне allowlist не принимается приложением", () => {
  const endpoint = "https://push.example.invalid/subscription";
  expect(isCanonicalPushEndpoint(endpoint)).toBe(true);
  expect(isTrustedPushEndpoint(endpoint)).toBe(false);
  expect(() => parsePushSubscription({ endpoint, keys })).toThrow(
    ValidationError,
  );
});
