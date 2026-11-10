export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  link: string;
}

export type PushResult = {
  status: "sent" | "gone" | "failed" | "disabled";
};

export interface PushSender {
  readonly enabled: boolean;
  send(
    subscription: PushSubscription,
    payload: PushPayload,
  ): Promise<PushResult>;
}
