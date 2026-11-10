import type {
  PushPayload,
  PushResult,
  PushSender,
  PushSubscription,
} from "@/application/ports/push-sender";

export class FakePushSender implements PushSender {
  enabled = true;
  calls: { subscription: PushSubscription; payload: PushPayload }[] = [];
  result: PushResult = { status: "sent" };
  beforeSend?: (
    subscription: PushSubscription,
    payload: PushPayload,
  ) => Promise<void>;

  async send(subscription: PushSubscription, payload: PushPayload) {
    this.calls.push(structuredClone({ subscription, payload }));
    await this.beforeSend?.(subscription, payload);
    return this.result;
  }
}
