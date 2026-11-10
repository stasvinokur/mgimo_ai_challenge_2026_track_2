import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { SPEECH_PAIR_LIMIT } from "@/application/today/briefing-audio";
import { readDemoAccountCounts } from "./demo-account-counts";
import { openStaffFixture } from "./staff-fixtures";
import { openTeacherTestData } from "./teacher-e2e-data";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const wav = Buffer.alloc(48);
wav.write("RIFF", 0);
wav.write("WAVE", 8);
const disabled = process.argv.includes("--disabled");
let synthesized = 0;
const stub = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += String(chunk);
  });
  request.on("end", () => {
    const payload = JSON.parse(body);
    assert.match(payload.text, /^[А-Яа-яЁё .,!?;:\-–—]+$/u);
    assert.equal(payload.voice, "aidar");
    synthesized++;
    response.writeHead(200, { "Content-Type": "audio/wav" });
    response.end(wav);
  });
});
await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
const address = stub.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${process.env.PORT || "3000"}`;
const app = spawn("pnpm", ["start"], {
  env: {
    ...process.env,
    TTS_URL: disabled ? "" : `http://127.0.0.1:${address.port}`,
  },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
let passed = 0;
let fixture: Awaited<ReturnType<typeof openStaffFixture>> | undefined;
let teacher: Awaited<ReturnType<typeof openTeacherTestData>> | undefined;
const rateKeys: string[] = [];
async function get(
  path: string,
  token?: string,
  ip = "192.0.2.157",
  extra: Record<string, string | null> = {},
) {
  const headers = new Headers({
    Origin: origin,
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    Accept: path === "/today" ? "text/html" : "audio/wav",
    "X-Forwarded-For": ip,
    ...(token ? { Cookie: `__Host-pulse-session=${token}` } : {}),
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value === null) headers.delete(key);
    else headers.set(key, value);
  }
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    headers,
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes, text: new TextDecoder().decode(bytes) };
}
function phrases(html: string) {
  return [
    ...html.matchAll(/data-testid="briefing-phrase"[^>]*>([\s\S]*?)<\/li>/g),
  ].map((match) =>
    (match[1] ?? "")
      .replace(/<!--.*?-->/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">"),
  );
}
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const result = await get("/api/health");
      if (result.response.status === 200) break;
    } catch {}
    assert(
      app.exitCode === null,
      "Production-сервер завершился раньше проверки",
    );
    await delay(100);
  }
  fixture = await openStaffFixture();
  teacher = await openTeacherTestData();
  const f = fixture;
  const before = await readDemoAccountCounts(f.sql);
  const [annaToken, timurToken, staffToken, teacherToken] = await Promise.all([
    f.session(f.anna),
    f.session(f.timur),
    f.session(f.marina),
    f.session(teacher.actor),
  ]);
  const ips = Array.from(
    { length: 11 },
    (_, number) => `192.0.2.${158 + number}`,
  );
  rateKeys.push(
    `briefing-speech:user:${hash(f.anna.userId)}`,
    ...["192.0.2.157", ...ips].map(
      (ip) => `briefing-speech:pair:${hash(`${f.anna.userId}\0${ip}`)}`,
    ),
  );
  for (const [token, status] of [
    [undefined, 401],
    [staffToken, 403],
    [teacherToken, 403],
  ] as const) {
    const result = await get(
      `/api/me/briefing/0?checksum=${"0".repeat(64)}`,
      token,
    );
    assert.equal(result.response.status, status);
    assert.equal(
      result.response.headers.get("cache-control"),
      "private, no-store",
    );
    passed++;
  }
  const own = phrases((await get("/today", annaToken)).text),
    foreign = phrases((await get("/today", timurToken)).text);
  const index = own.findIndex((phrase) => phrase.startsWith("Главное:"));
  assert(index >= 0);
  const path = `/api/me/briefing/${index}?checksum=${hash(own[index] ?? "")}`;
  const result = await get(path, annaToken);
  assert.equal(result.response.status, disabled ? 503 : 200);
  if (!disabled)
    assert.equal(result.response.headers.get("content-type"), "audio/wav");
  assert.equal(
    result.response.headers.get("cache-control"),
    "private, no-store",
  );
  assert.equal(
    result.response.headers.get("x-content-type-options"),
    "nosniff",
  );
  if (!disabled) assert.deepEqual(result.bytes, new Uint8Array(wav));
  passed++;
  await get(path, annaToken);
  assert.equal(synthesized, disabled ? 0 : 1);
  passed++;
  const foreignIndex = foreign.findIndex((phrase) =>
    phrase.includes("Основы маркетинга"),
  );
  assert(foreignIndex >= 0);
  assert.equal(
    (
      await get(
        `/api/me/briefing/${foreignIndex}?checksum=${hash(foreign[foreignIndex] ?? "")}`,
        annaToken,
      )
    ).response.status,
    409,
  );
  passed++;
  for (const suffix of [
    "&text=Чужой",
    "&studentId=foreign",
    "&userId=foreign",
    "&voice=xenia",
  ]) {
    assert.equal((await get(path + suffix, annaToken)).response.status, 400);
    passed++;
  }
  assert.equal(
    (
      await get(
        `/api/me/briefing/99?checksum=${hash(own[index] ?? "")}`,
        annaToken,
      )
    ).response.status,
    404,
  );
  passed++;
  const countQuota = async () => {
    const [row] = await f.sql<
      { count: number }[]
    >`select count(*)::int as count from login_attempts where key in ${f.sql(rateKeys)}`;
    return row?.count ?? 0;
  };
  const beforeQuota = await countQuota();
  for (const value of [
    "",
    "x",
    "0".repeat(63),
    "A".repeat(64),
    "g".repeat(64),
    "0".repeat(65),
  ]) {
    assert.equal(
      (await get(`/api/me/briefing/${index}?checksum=${value}`, annaToken))
        .response.status,
      400,
    );
    passed++;
  }
  for (const site of [null, "cross-site", "same-site", "none"]) {
    assert.equal(
      (await get(path, annaToken, "192.0.2.157", { "Sec-Fetch-Site": site }))
        .response.status,
      403,
    );
    passed++;
  }
  assert.equal(await countQuota(), beforeQuota);
  passed++;
  await f.sql`update users set seed_key=${`demo:tts-visitor:${f.anna.userId}`} where id=${f.anna.userId}`;
  for (const ip of ips.slice(0, 10)) {
    await Promise.all(
      Array.from({ length: SPEECH_PAIR_LIMIT }, async () => {
        assert.equal(
          (await get(path, annaToken, ip)).response.status,
          disabled ? 503 : 200,
        );
      }),
    );
    assert.equal((await get(path, annaToken, ip)).response.status, 429);
  }
  assert.equal(
    (await get(path, annaToken, ips[10])).response.status,
    disabled ? 503 : 200,
  );
  const [userQuota] = await f.sql<
    { count: number }[]
  >`select count(*)::int as count from login_attempts where key=${`briefing-speech:user:${hash(f.anna.userId)}`}`;
  assert.equal(userQuota?.count ?? 0, disabled ? 0 : 1);
  assert.equal(synthesized, disabled ? 0 : 1);
  passed++;
  await f.sql`update users set seed_key=null where id=${f.anna.userId}`;
  assert.deepEqual(await readDemoAccountCounts(f.sql), before);
  passed++;
} finally {
  if (fixture) {
    await fixture.sql`update users set seed_key=null where id=${fixture.anna.userId}`;
    if (rateKeys.length)
      await fixture.sql`delete from login_attempts where key in ${fixture.sql(rateKeys)}`;
  }
  await teacher?.close();
  await fixture?.close();
  if (app.pid) {
    process.kill(-app.pid, "SIGTERM");
    await new Promise<void>((resolve) => app.once("exit", () => resolve()));
  }
  await new Promise<void>((resolve) => stub.close(() => resolve()));
}
console.log(
  `Озвучка ${disabled ? "без TTS_URL" : "с WAV-заглушкой"}, production HTTP: ${passed}/${passed}; временные данные удалены.`,
);
