import {
  createDecipheriv,
  createECDH,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import https from "node:https";
import { expect, it, vi } from "vitest";
import webPush from "web-push";
import {
  DisabledPushSender,
  WebPushSender,
} from "@/infrastructure/push/sender";

const payload = {
  title: "Заявка готова",
  body: "Откройте кабинет, чтобы узнать подробности.",
  link: "/requests/test",
};

function subscription() {
  const receiver = createECDH("prime256v1");
  const publicKey = receiver.generateKeys();
  const auth = randomBytes(16);
  return {
    receiver,
    publicKey,
    auth,
    subscription: {
      endpoint: "https://push.example.invalid/subscription",
      keys: {
        p256dh: publicKey.toString("base64url"),
        auth: auth.toString("base64url"),
      },
    },
  };
}

function interceptPush(statusCode = 201) {
  let body = Buffer.alloc(0);
  let headers: RequestOptions["headers"];
  const request = vi
    .spyOn(https, "request")
    .mockImplementation((...args: unknown[]) => {
      const options = args[0] as RequestOptions;
      const callback = args[1] as (response: IncomingMessage) => void;
      headers = options.headers;
      const outgoing = new EventEmitter();
      Object.assign(outgoing, {
        write(chunk: Buffer) {
          body = Buffer.from(chunk);
        },
        end() {
          const response = new EventEmitter();
          Object.assign(response, { statusCode, headers: {} });
          callback(response as IncomingMessage);
          response.emit("end");
        },
      });
      return outgoing as ClientRequest;
    });
  return { request, body: () => body, headers: () => headers };
}

function decryptPush(body: Buffer, target: ReturnType<typeof subscription>) {
  const salt = body.subarray(0, 16);
  expect(body.readUInt32BE(16)).toBeGreaterThan(body.length - 86);
  const keyLength = body.readUInt8(20);
  const senderKey = body.subarray(21, 21 + keyLength);
  const secret = target.receiver.computeSecret(senderKey);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    target.publicKey,
    senderKey,
  ]);
  const ikm = hkdfSync("sha256", secret, target.auth, keyInfo, 32);
  const key = hkdfSync(
    "sha256",
    ikm,
    salt,
    Buffer.from("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = hkdfSync(
    "sha256",
    ikm,
    salt,
    Buffer.from("Content-Encoding: nonce\0"),
    12,
  );
  const cipher = body.subarray(21 + keyLength);
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(cipher.subarray(-16));
  const padded = Buffer.concat([
    decipher.update(cipher.subarray(0, -16)),
    decipher.final(),
  ]);
  let last = padded.length - 1;
  while (padded[last] === 0) last--;
  expect(padded[last]).toBe(2);
  return JSON.parse(padded.subarray(0, last).toString("utf8"));
}

it("отправляет зашифрованный aes128gcm payload, который расшифровывает только получатель", async () => {
  const target = subscription();
  const outgoing = interceptPush();
  const sender = new WebPushSender({
    ...webPush.generateVAPIDKeys(),
    subject: "mailto:push@example.invalid",
  });
  expect(sender.enabled).toBe(true);
  expect(await sender.send(target.subscription, payload)).toEqual({
    status: "sent",
  });
  expect(outgoing.request).toHaveBeenCalledOnce();
  expect(outgoing.headers()).toMatchObject({
    "Content-Encoding": "aes128gcm",
    TTL: 300,
  });
  expect(outgoing.body().includes(Buffer.from(payload.title))).toBe(false);
  expect(decryptPush(outgoing.body(), target)).toEqual(payload);
  expect(() => decryptPush(outgoing.body(), subscription())).toThrow();
  const altered = Buffer.from(outgoing.body());
  altered[altered.length - 1] = (altered[altered.length - 1] ?? 0) ^ 1;
  expect(() => decryptPush(altered, target)).toThrow();
});

it.each([404, 410, 403, 429, 500])(
  "переводит ответ push-службы %i в безопасный результат",
  async (status) => {
    interceptPush(status);
    const sender = new WebPushSender({
      ...webPush.generateVAPIDKeys(),
      subject: "https://example.invalid/contact",
    });
    expect(await sender.send(subscription().subscription, payload)).toEqual({
      status: status === 404 || status === 410 ? "gone" : "failed",
    });
  },
);

it("выключенный адаптер не обращается к библиотеке и сети", async () => {
  const request = vi.spyOn(https, "request");
  const send = vi.spyOn(webPush, "sendNotification");
  const sender = new DisabledPushSender();
  expect(sender.enabled).toBe(false);
  expect(await sender.send()).toEqual({ status: "disabled" });
  expect(send).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it.each(["http://push.example.invalid/subscription", "file:///tmp/push"])(
  "не отправляет на небезопасный endpoint %s",
  async (endpoint) => {
    const send = vi.spyOn(webPush, "sendNotification");
    const sender = new WebPushSender({
      ...webPush.generateVAPIDKeys(),
      subject: "mailto:push@example.invalid",
    });
    expect(
      await sender.send({ ...subscription().subscription, endpoint }, payload),
    ).toEqual({ status: "failed" });
    expect(send).not.toHaveBeenCalled();
  },
);

it.each([
  "https://example.invalid/",
  "//example.invalid/",
  "/\\example.invalid/",
  "/\t/example.invalid/",
  "/\n/example.invalid/",
  "/%2fexample.invalid/",
  "/%2Fexample.invalid/",
  "/%5cexample.invalid/",
  "/%0a/example.invalid/",
  "/\u0000/example.invalid/",
])("отклоняет внешнюю ссылку в payload %s", async (link) => {
  const send = vi.spyOn(webPush, "sendNotification");
  const sender = new WebPushSender({
    ...webPush.generateVAPIDKeys(),
    subject: "mailto:push@example.invalid",
  });
  expect(
    await sender.send(subscription().subscription, { ...payload, link }),
  ).toEqual({ status: "failed" });
  expect(send).not.toHaveBeenCalled();
});
