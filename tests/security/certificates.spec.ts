import type { APIResponse } from "@playwright/test";
import { certificatePdfText } from "../unit/certificates-pdf-text";
import { expect, test } from "./certificates-fixture";
import { loginAsTestStaff } from "./staff-login";
import { loginAsTestStudent } from "./student-login";

function expectVerificationHeaders(response: APIResponse) {
  expect(response.headers()["content-security-policy"]).toBe(
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
}

test("PDF: 401 без входа, 403 сотруднику, 404 Тимуру и неготовой справке", async ({
  page,
  request,
  certificates: f,
}) => {
  const ready = await f.request();
  const pending = await f.request("submitted");
  const path = `/api/requests/${ready.id}/pdf`;
  expect((await request.get(path)).status()).toBe(401);
  await loginAsTestStudent(page, f.timur.credentials);
  for (const suffix of [
    "",
    `?studentId=${f.anna.actor.studentId}&userId=${f.anna.actor.userId}`,
  ]) {
    const foreign = await page.request.get(path + suffix);
    expect(foreign.status()).toBe(404);
    expect(await foreign.text()).not.toContain("Соколова");
  }
  await loginAsTestStaff(page, f.staff.limitedCredentials);
  expect((await page.request.get(path)).status()).toBe(403);
  await loginAsTestStudent(page, f.anna.credentials);
  for (const id of [pending.id, f.staff.ids.next(), "not-a-uuid"])
    expect((await page.request.get(`/api/requests/${id}/pdf`)).status()).toBe(
      404,
    );
  const own = await page.request.get(path);
  expect(own.status()).toBe(200);
  expect(own.headers()["cache-control"]).toBe("private, no-store");
  const text = await certificatePdfText(await own.body());
  const profile = await f.students.findProfileForStudent(
    f.anna.actor.studentId,
  );
  expect(profile).not.toBeNull();
  expect(text).not.toContain(profile?.recordBookNo);
});

test("публичная проверка раскрывает минимум данных и ограничивает перебор", async ({
  request,
  certificates: f,
  certificateIp,
}) => {
  const ready = await f.request();
  const certificate = ready.certificate;
  if (!certificate) throw new Error("Нужна готовая справка.");
  const headers = { "x-forwarded-for": certificateIp };
  const valid = await request.get(`/verify/${certificate.verifyCode}`, {
    headers,
  });
  expect(valid.status()).toBe(200);
  expectVerificationHeaders(valid);
  expect(valid.headers()["x-robots-tag"]).toContain("noindex");
  const body = await valid.text();
  const profile = await f.students.findProfileForStudent(
    f.anna.actor.studentId,
  );
  if (!profile) throw new Error("Нужен профиль.");
  expect(body).toContain("Соколова А.");
  for (const value of [
    profile.fullName,
    profile.recordBookNo,
    profile.group,
    profile.faculty,
    profile.program,
    certificate.destination,
    f.anna.actor.studentId,
  ])
    expect(body).not.toContain(value);
  for (let index = 0; index < 29; index++) {
    const code =
      index % 2 === 0
        ? "invalid-code"
        : `${"A".repeat(24)}${"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[index]}A`;
    const unknown = await request.get(`/verify/${code}`, { headers });
    expect(unknown.status()).toBe(404);
    expectVerificationHeaders(unknown);
  }
  const limited = await request.get(`/verify/${certificate.verifyCode}`, {
    headers,
  });
  expect(limited.status()).toBe(429);
  expect(limited.headers()["retry-after"]).toBe("600");
  expect(await limited.text()).not.toContain(certificate.number);
});

test("Анна не получает QR и код справки Тимура через страницу, RSC и PDF", async ({
  page,
  certificates: f,
}) => {
  if (f.staff.limited.kind !== "staff" || f.timur.actor.kind !== "student")
    throw new Error("Нужны тестовые роли");
  const id = await f.staff.request(f.timur.actor);
  const staff = { ...f.staff.limited, facultyIds: [f.timur.actor.facultyId] };
  for (const to of ["accepted", "in_progress", "ready"] as const)
    await f.staff.change.execute(staff, { id, to });
  const certificate = await f.repo.findByRequestIdForStudent(
    id,
    f.timur.actor.studentId,
  );
  if (!certificate) throw new Error("Нужна справка Тимура");
  await loginAsTestStudent(page, f.anna.credentials);
  const path = `/requests/${id}`;
  const variants: Record<string, string>[] = [
    {},
    {
      RSC: "1",
      "Next-Router-State-Tree": encodeURIComponent(
        JSON.stringify([
          "",
          {
            children: [
              "(student)",
              { children: ["requests", { children: ["__PAGE__", {}] }] },
            ],
          },
        ]),
      ),
    },
  ];
  for (const headers of variants) {
    const response = await page.request.get(
      `${path}?studentId=${f.timur.actor.studentId}`,
      { headers },
    );
    const body = await response.text();
    if (headers.RSC) expect(body).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
    else expect(response.status()).toBe(404);
    for (const value of [
      certificate.number,
      certificate.verifyCode,
      `/verify/${certificate.verifyCode}`,
      "data:image/png;base64,",
    ])
      expect(body).not.toContain(value);
  }
  const response = await page.goto(path);
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("region", { name: "Готовая справка" }),
  ).toHaveCount(0);
  expect((await page.request.get(`/api/requests/${id}/pdf`)).status()).toBe(
    404,
  );
  const pending = await f.request("submitted");
  const own = await page.goto(`/requests/${pending.id}`);
  expect(own?.status()).toBe(200);
  expect(await own?.text()).not.toContain("data:image/png;base64,");
  await expect(
    page.getByRole("region", { name: "Готовая справка" }),
  ).toHaveCount(0);
});
