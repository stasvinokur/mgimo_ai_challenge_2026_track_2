import { expect, it } from "vitest";
import {
  LOGIN_LIMITS,
  LOGIN_WINDOW_SEC,
  SESSION_ABSOLUTE_TTL_MS,
  sessionExpiry,
} from "@/domain/identity/session-policy";

it("пороги пары, NAT и распределённого подбора различаются в одном окне", () => {
  expect(LOGIN_LIMITS).toEqual({ pair: 5, ip: 20, login: 50 });
  expect(LOGIN_WINDOW_SEC).toBe(900);
});

it("продление ограничено семью днями от активности и 30 днями от создания", () => {
  const created = new Date("2026-11-04T09:00:00Z");
  expect(sessionExpiry(created, created)).toEqual(
    new Date("2026-11-11T09:00:00Z"),
  );
  expect(sessionExpiry(new Date("2026-12-01T09:00:00Z"), created)).toEqual(
    new Date(created.getTime() + SESSION_ABSOLUTE_TTL_MS),
  );
});
