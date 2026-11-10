import assert from "node:assert/strict";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { precacheURLs } from "../e2e/pwa-precache";
import {
  certificatePdfHasQrUrl,
  certificatePdfHasVerificationLink,
} from "../unit/certificates-pdf-qr";
import { openAttendanceTestData } from "./attendance-data";
import { openCertificatesFixture } from "./certificates-fixture";

const origin = `http://localhost:${process.env.PORT || "3000"}`;
const base = "/dekanat";
const f = await openCertificatesFixture();
const attendance = await openAttendanceTestData({ lessonTime: "around-now" });
const tokens = new CryptoSessionTokens();
const sessions = new PostgresSessionStore(() => f.staff.sql);
const ids: string[] = [];
let checks = 0;
let todayHtml = "";
function check(value: unknown) {
  assert(value, "HTTP-проверка /dekanat не пройдена.");
  checks++;
}
async function cookie(userId: string) {
  const token = tokens.generate(),
    id = f.staff.ids.next(),
    now = new Date().toISOString();
  ids.push(id);
  await sessions.create({
    id,
    userId,
    tokenHash: tokens.hash(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  return `__Host-pulse-session=${token}`;
}
async function request(path: string, auth = "", init: RequestInit = {}) {
  try {
    return await fetch(`${origin}${base}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      ...init,
      headers: {
        Cookie: auth,
        Origin: origin,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        ...init.headers,
      },
    });
  } catch {
    throw new Error("BASE_PATH_HTTP_UNAVAILABLE");
  }
}
function checkLinks(html: string) {
  for (const match of html.matchAll(/(?:href|src|action)="(\/(?!\/)[^"]*)"/g))
    check(match[1]?.startsWith(`${base}/`));
}
try {
  const entry = await request("/");
  check(
    entry.status === 307 &&
      new URL(entry.headers.get("location") ?? "", origin).pathname ===
        `${base}/today`,
  );
  await entry.text();
  const anna = await cookie(f.anna.actor.userId),
    timur = await cookie(f.timur.actor.userId),
    staff = await cookie(f.staff.limited.userId),
    teacher = await cookie(attendance.teacher.actor.userId),
    student = await cookie(attendance.student.actor.userId);
  const neighborOnly = await request(
    "/api/me/pulse",
    anna.replace("__Host-pulse-session", "__Host-session"),
  );
  check(neighborOnly.status === 401);
  await neighborOnly.text();
  const ownPulse = await request("/api/me/pulse", anna);
  check(ownPulse.status === 200);
  await ownPulse.text();
  const anon = await request("/grades");
  const target = new URL(anon.headers.get("location") ?? "", origin);
  check(
    anon.status === 307 &&
      target.pathname === `${base}/login` &&
      target.searchParams.get("next") === "/grades",
  );
  await anon.text();
  for (const [auth, paths] of [
    [
      anna,
      [
        "/today",
        "/schedule",
        "/grades",
        "/requests",
        "/profile",
        "/notifications",
        "/search?q=география",
        "/regulations",
      ],
    ],
    [staff, ["/staff/requests", "/staff/profile"]],
    [teacher, ["/teacher", attendance.path]],
  ] as const) {
    for (const path of paths) {
      const response = await request(path, auth, {
        headers: { Accept: "text/html" },
      });
      check(response.status === 200);
      const html = await response.text();
      checkLinks(html);
      if (path === "/today") todayHtml = html;
    }
  }
  const phrase = todayHtml
    .match(/data-testid="briefing-phrase"[^>]*>([\s\S]*?)<\/li>/)?.[1]
    ?.replace(/<!--.*?-->/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  check(Boolean(phrase));
  const audio = await request(
    `/api/me/briefing/0?checksum=${tokens.hash(phrase ?? "")}`,
    anna,
    { headers: { Accept: "audio/wav" } },
  );
  check(
    audio.status === 200 && audio.headers.get("content-type") === "audio/wav",
  );
  check(new Uint8Array(await audio.arrayBuffer()).length === 48);
  const lang = await request(
    "/login",
    "pulse-language=en; pulse-language-dekanat=ru",
  );
  check((await lang.text()).includes('<html lang="ru"'));
  for (const [auth, home] of [
    [staff, "/staff/requests"],
    [teacher, "/teacher"],
  ]) {
    const response = await request("/grades/unused/data", auth);
    check(
      response.status === 307 &&
        response.headers.get("location") === `${base}${home}`,
    );
    await response.text();
  }
  const sw = await request("/sw.js");
  check(sw.headers.get("service-worker-allowed") === `${base}/`);
  const urls = precacheURLs(await sw.text());
  for (const url of urls) {
    check(url.startsWith(`${base}/`));
    const response = await request(url.slice(base.length));
    check(response.status === 200);
    await response.arrayBuffer();
  }
  const manifest = await (await request("/manifest.webmanifest")).json();
  check(
    manifest.start_url === `${base}/today` &&
      manifest.scope === `${base}/` &&
      manifest.id === `${base}/`,
  );
  for (const icon of manifest.icons)
    check(icon.src.startsWith(`${base}/icons/`));
  checkLinks(await (await request("/offline.html")).text());
  const ready = await f.request();
  const verificationURL = `${origin}${base}/verify/${ready.certificate?.verifyCode}`;
  const pdf = await request(`/api/requests/${ready.id}/pdf`, anna);
  check(pdf.status === 200);
  const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
  check(await certificatePdfHasQrUrl(pdfBytes, verificationURL));
  check(await certificatePdfHasVerificationLink(pdfBytes, verificationURL));
  const verify = await request(`/verify/${ready.certificate?.verifyCode}`);
  check(verify.status === 200);
  checkLinks(await verify.text());
  for (const path of [
    `/requests/${ready.id}`,
    `/api/requests/${ready.id}/pdf`,
  ]) {
    const foreign = await request(path, timur);
    check(foreign.status === 404);
    await foreign.text();
  }
  const options = await request("/api/passkeys/registration/options", anna, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  check(options.status === 200);
  check(
    options.headers
      .getSetCookie()
      .some(
        (cookie) =>
          cookie.startsWith("__Host-passkey-registration-dekanat=") &&
          cookie.includes("Path=/;"),
      ),
  );
  check((await options.json()).rp.id === "localhost");
  const denied = await request("/api/passkeys/registration/options", anna, {
    method: "POST",
    headers: {
      Origin: "https://neighbor.example",
      "Sec-Fetch-Site": "cross-site",
    },
  });
  check(denied.status === 403);
  await denied.text();
  const live = `${attendance.path}/live`;
  const issued = await request(live, teacher, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "issue" }),
  });
  check(issued.status === 200);
  const code = await issued.json();
  check(code.url.startsWith(`${origin}${base}/attend/`));
  const confirmation = await request(
    new URL(code.url).pathname.slice(base.length),
    student,
  );
  check(confirmation.status === 200);
  checkLinks(await confirmation.text());
  const forbidden = await request("/staff/requests", anna);
  check(forbidden.status === 403);
  await forbidden.text();
  const headers = {
    RSC: "1",
    "Next-Router-State-Tree": encodeURIComponent(
      JSON.stringify([
        "",
        {
          children: [
            "(staff)",
            {
              children: [
                "staff",
                {
                  children: [
                    "requests",
                    { children: ["__PAGE__", {}, null, "refetch"] },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    ),
  };
  let flight = await request("/staff/requests", anna, { headers });
  if (flight.status === 307) {
    const next = new URL(flight.headers.get("location") ?? "", origin);
    check(
      next.pathname === `${base}/staff/requests` &&
        next.searchParams.has("_rsc"),
    );
    await flight.text();
    flight = await request(
      next.pathname.slice(base.length) + next.search,
      anna,
      { headers },
    );
  }
  const body = await flight.text();
  check(flight.status === 403 || body.includes("NEXT_HTTP_ERROR_FALLBACK;403"));
  console.info(
    `Проверки HTTP /dekanat: ${checks}; precache: ${urls.length}/200; роли, IDOR, Origin, RP ID и RSC — успешно.`,
  );
} finally {
  for (const id of ids) await sessions.revoke(id);
  await attendance.close();
  await f.close();
}
