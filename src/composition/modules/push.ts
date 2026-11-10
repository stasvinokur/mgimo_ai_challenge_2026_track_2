import "server-only";
import type { PushSender } from "@/application/ports/push-sender";
import { getBasePath } from "@/infrastructure/config/base-path";
import { getEnv } from "@/infrastructure/config/env";
import {
  DisabledPushSender,
  WebPushSender,
} from "@/infrastructure/push/sender";

export function createPushSender(): PushSender {
  const publicKey = getEnv("VAPID_PUBLIC_KEY");
  const privateKey = getEnv("VAPID_PRIVATE_KEY");
  const subject = getEnv("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) return new DisabledPushSender();
  return new WebPushSender({ publicKey, privateKey, subject }, getBasePath());
}
