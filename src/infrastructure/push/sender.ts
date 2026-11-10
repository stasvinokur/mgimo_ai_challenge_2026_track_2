import webPush from "web-push";
import type {
  PushPayload,
  PushResult,
  PushSender,
  PushSubscription,
} from "@/application/ports/push-sender";
import { appPath } from "@/application/shared/app-path.mjs";
import { isCanonicalPushEndpoint } from "@/domain/notifications/push-subscription-policy";
import { isInternalNotificationLink } from "@/domain/notifications/quiet-mode";

export interface VapidConfiguration {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export class DisabledPushSender implements PushSender {
  readonly enabled = false;

  async send(): Promise<PushResult> {
    return { status: "disabled" };
  }
}

export class WebPushSender implements PushSender {
  readonly enabled = true;

  constructor(
    private readonly vapid: VapidConfiguration,
    private readonly basePath = "",
  ) {}

  async send(
    subscription: PushSubscription,
    payload: PushPayload,
  ): Promise<PushResult> {
    try {
      if (
        !isCanonicalPushEndpoint(subscription.endpoint) ||
        !isInternalNotificationLink(payload.link)
      ) {
        return { status: "failed" };
      }
      await webPush.sendNotification(
        subscription,
        JSON.stringify({
          title: payload.title,
          body: payload.body,
          link: appPath(payload.link, this.basePath),
        }),
        {
          vapidDetails: this.vapid,
          contentEncoding: "aes128gcm",
          TTL: 300,
          timeout: 2_000,
        },
      );
      return { status: "sent" };
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "statusCode" in error &&
        (error.statusCode === 404 || error.statusCode === 410)
      ) {
        return { status: "gone" };
      }
      return { status: "failed" };
    }
  }
}
