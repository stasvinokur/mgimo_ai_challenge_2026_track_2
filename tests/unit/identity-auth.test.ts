import { expect, it } from "vitest";
import { getClientIp } from "@/infrastructure/auth/request-ip";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/infrastructure/auth/session-cookie";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";

it("генерирует 32 случайных байта base64url, хранит SHA-256 без исходного токена", () => {
  const tokens = new CryptoSessionTokens();
  const first = tokens.generate();
  expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(Buffer.from(first, "base64url")).toHaveLength(32);
  expect(tokens.generate()).not.toBe(first);
  expect(tokens.hash(first)).toMatch(/^[a-f0-9]{64}$/);
  expect(tokens.hash("abc")).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

it("cookie имеет флаги __Host- и удаляется с теми же атрибутами", () => {
  expect(SESSION_COOKIE).toBe("__Host-pulse-session");
  expect(sessionCookieOptions("2026-11-11T09:00:00Z")).toEqual({
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: new Date("2026-11-11T09:00:00Z"),
  });
  expect(sessionCookieOptions(new Date(0).toISOString()).expires).toEqual(
    new Date(0),
  );
});

it("IP берётся только справа в X-Forwarded-For; без заголовка — соединение или unknown", () => {
  expect(getClientIp("203.0.113.50, 192.0.2.1")).toBe("192.0.2.1");
  expect(getClientIp("192.0.2.1, 2001:db8::1")).toBe("2001:db8:0:0::/64");
  expect(getClientIp("192.0.2.1, invalid", "127.0.0.1")).toBe("unknown");
  expect(getClientIp(null, "127.0.0.1")).toBe("127.0.0.1");
  expect(getClientIp(null)).toBe("unknown");
});

it("IPv6 учитывается по /64, IPv4-mapped не обходит IPv4-лимит", () => {
  expect(getClientIp("2001:db8:1234:5678::1")).toBe(
    getClientIp("2001:0DB8:1234:5678:ffff:abcd:0000:42"),
  );
  expect(getClientIp("2001:db8:1234:5678::1")).not.toBe(
    getClientIp("2001:db8:1234:5679::1"),
  );
  for (const address of [
    "::ffff:192.0.2.1",
    "::FFFF:c000:201",
    "0:0:0:0:0:ffff:c000:0201",
  ])
    expect(getClientIp(address)).toBe("192.0.2.1");
  expect(getClientIp("::1")).toBe(getClientIp("0:0:0:0:0:0:0:1"));
});
