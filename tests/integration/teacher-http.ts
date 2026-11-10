import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { PostgresIdentityRepository } from "@/infrastructure/db/repositories/identity/users";
import { PostgresCalendarTokenStore } from "@/infrastructure/db/repositories/schedule/repository";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { openStudentTestData } from "./student-e2e-data";

export async function checkTeacherHttp(baseURL: string) {
  const sql = createDatabase(2),
    ids = new UuidV7Generator(),
    tokens = new CryptoSessionTokens();
  const sessions = new PostgresSessionStore(() => sql);
  const sessionIds: string[] = [];
  const student = await openStudentTestData("anna");
  let checks = 0;
  try {
    const calendarToken = tokens.generate();
    await new PostgresCalendarTokenStore(() => sql).replaceForStudent(
      student.actor.studentId,
      ids.next(),
      tokens.hash(calendarToken),
    );
    const calendarPath = `/api/calendar/${calendarToken}`;
    const origin = new URL(baseURL).origin;
    for (const role of ["anonymous", "anna", "marina", "oleg"] as const) {
      let cookie = "";
      if (role !== "anonymous") {
        const user = await new PostgresIdentityRepository(
          () => sql,
        ).findCredentials(role);
        assert(user, "Нужен демо-сид.");
        const token = tokens.generate(),
          id = ids.next(),
          now = new Date().toISOString();
        await sessions.create({
          id,
          userId: user.userId,
          tokenHash: tokens.hash(token),
          createdAt: now,
          lastSeenAt: now,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        });
        sessionIds.push(id);
        cookie = `__Host-pulse-session=${token}`;
      }
      async function request(path: string, init: RequestInit = {}) {
        try {
          return await fetch(new URL(path, baseURL), {
            ...init,
            redirect: "manual",
            headers: {
              cookie,
              Origin: origin,
              "Sec-Fetch-Site": "same-origin",
              "Sec-Fetch-Mode": "cors",
              "Sec-Fetch-Dest": "empty",
              ...init.headers,
            },
          });
        } catch {
          throw new Error("Не удалось выполнить HTTP-проверку роли.");
        }
      }
      for (const path of ["/today", "/staff/requests", "/teacher"] as const) {
        const expected =
          role === "anonymous"
            ? 307
            : path === "/teacher"
              ? role === "oleg"
                ? 200
                : 403
              : path === "/staff/requests"
                ? role === "marina"
                  ? 200
                  : 403
                : role === "anna"
                  ? 200
                  : 307;
        const response = await request(path, {
          headers: {
            Accept: "text/html",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Dest": "document",
          },
        });
        assert.equal(response.status, expected, `${role} ${path}`);
        const body = await response.text();
        if (expected === 307) {
          const destination = new URL(
            response.headers.get("location") ?? "",
            baseURL,
          ).pathname;
          assert.equal(
            destination,
            role === "anonymous"
              ? "/login"
              : role === "oleg"
                ? "/teacher"
                : "/staff/requests",
          );
        }
        if (path === "/teacher" && expected === 200) {
          assert(body.includes("Мои пары"));
          assert(!body.includes("Номер зачётки"));
        }
        checks++;
        const segments = path.split("/").filter(Boolean);
        let branch: unknown[] = ["__PAGE__", {}, null, "refetch"];
        for (const segment of [...segments].reverse())
          branch = [segment, { children: branch }];
        const group =
          path === "/teacher"
            ? "(teacher)"
            : path.startsWith("/staff")
              ? "(staff)"
              : "(student)";
        const tree = ["", { children: [group, { children: branch }] }];
        const flightHeaders = {
          RSC: "1",
          "Next-Router-State-Tree": encodeURIComponent(JSON.stringify(tree)),
        };
        let flight = await request(path, { headers: flightHeaders });
        if (flight.status === 307) {
          const location = new URL(
            flight.headers.get("location") ?? "",
            baseURL,
          );
          if (location.pathname === path && location.searchParams.has("_rsc")) {
            await flight.text();
            flight = await request(`${location.pathname}${location.search}`, {
              headers: flightHeaders,
            });
          }
        }
        const payload = await flight.text();
        if (expected === 403)
          assert(
            flight.status === 403 ||
              payload.includes("NEXT_HTTP_ERROR_FALLBACK;403"),
            `RSC ${role} ${path}`,
          );
        else if (expected === 307)
          assert(
            flight.status === 307 || payload.includes("NEXT_REDIRECT"),
            `RSC ${role} ${path}`,
          );
        else assert.equal(flight.status, 200, `RSC ${role} ${path}`);
        checks++;
      }
      for (const [path, method] of [
        ["/api/me/pulse", "GET"],
        ["/api/assistant", "POST"],
        [`/api/requests/${randomUUID()}/pdf`, "GET"],
        [calendarPath, "GET"],
      ] as const) {
        const response = await request(
          path,
          method === "POST"
            ? {
                method,
                headers: { "Content-Type": "application/json" },
                body: "{}",
              }
            : {},
        );
        const expected =
          path === calendarPath
            ? role === "anonymous"
              ? 200
              : 404
            : role === "anonymous"
              ? 401
              : role !== "anna"
                ? 403
                : path === "/api/me/pulse"
                  ? 200
                  : path === "/api/assistant"
                    ? 400
                    : 404;
        assert.equal(
          response.status,
          expected,
          `${role} API ${path === calendarPath ? "ICS" : path}`,
        );
        const body = await response.text();
        if (role === "oleg" || role === "marina")
          assert(!body.includes("BEGIN:VCALENDAR"));
        checks++;
      }
    }
    return { checks };
  } finally {
    for (const id of sessionIds) await sessions.revoke(id);
    await student.close();
    await sql.end({ timeout: 1 });
  }
}

if (import.meta.main) {
  try {
    console.info(
      await checkTeacherHttp(`http://127.0.0.1:${process.env.PORT || "3000"}`),
    );
  } catch (error) {
    console.error(
      error instanceof assert.AssertionError
        ? error.message
        : "HTTP-проверка не завершена.",
    );
    process.exitCode = 1;
  }
}
