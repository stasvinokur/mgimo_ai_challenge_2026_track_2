import { expect, it, vi } from "vitest";
import {
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
} from "@/application/shared/errors";
import { certificateRecord, certificateRequestId } from "../fakes/certificates";
import { anna, marina } from "../fakes/identity";

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  download: vi.fn(),
  verify: vi.fn(),
  ipHash: vi.fn(() => "ip-hash"),
  tokens: vi.fn(async () => ":root{}"),
  error: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/_lib/get-actor", () => ({ getActor: mocks.getActor }));
vi.mock("@/composition/container", () => ({
  certificates: {
    download: { execute: mocks.download },
    verify: { execute: mocks.verify },
    ipHash: mocks.ipHash,
    tokens: mocks.tokens,
  },
  getConcept: {
    execute: () => ({ notice: "Конкурсный концепт. Все данные вымышлены." }),
  },
  system: { logger: { error: mocks.error } },
}));

import { GET as download } from "@/app/api/requests/[id]/pdf/route";
import { GET as verify } from "@/app/verify/[code]/route";

function expectVerificationHeaders(response: Response) {
  expect(response.headers.get("content-security-policy")).toBe(
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}

it.each([
  [null, 401],
  [marina, 403],
] as const)("PDF: роль %s → %s без redirect", async (actor, status) => {
  mocks.getActor.mockResolvedValue(actor);
  const response = await download(new Request("https://pulse.example"), {
    params: Promise.resolve({ id: certificateRequestId }),
  });
  expect(response.status).toBe(status);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("PDF отдаёт байты, приватные заголовки и UTF-8 имя файла", async () => {
  mocks.getActor.mockResolvedValue(anna);
  mocks.download.mockResolvedValue({
    number: certificateRecord.number,
    bytes: new Uint8Array([37, 80, 68, 70]),
  });
  const response = await download(new Request("https://pulse.example"), {
    params: Promise.resolve({ id: certificateRequestId }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(response.headers.get("content-disposition")).toContain(
    'attachment; filename="spravka-C-2026-000045.pdf"',
  );
  expect(response.headers.get("content-disposition")).toContain(
    encodeURIComponent("spravka-С-2026-000045.pdf"),
  );
  expect(await response.text()).toBe("%PDF");
});

it.each([
  [new NotFoundError(), 404],
  [new ForbiddenError(), 403],
])("PDF сохраняет HTTP-ошибку %s", async (error, status) => {
  mocks.getActor.mockResolvedValue(anna);
  mocks.download.mockRejectedValue(error);
  const response = await download(new Request("https://pulse.example"), {
    params: Promise.resolve({ id: certificateRequestId }),
  });
  expect(response.status).toBe(status);
});

it.each([
  [new NotFoundError(), 404],
  [new RateLimitedError(), 429],
  [new Error("private-data"), 500],
])(
  "публичная HTML-страница возвращает настоящий статус %s",
  async (error, status) => {
    mocks.verify.mockRejectedValue(error);
    const response = await verify(
      new Request("https://pulse.example/verify/bad"),
      { params: Promise.resolve({ code: "bad" }) },
    );
    expect(response.status).toBe(status);
    expectVerificationHeaders(response);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const text = await response.text();
    expect(text).toContain('name="robots" content="noindex');
    expect(text).not.toContain("private-data");
    if (status === 429) {
      expect(response.headers.get("retry-after")).toBe("600");
      expect(text).toContain("Повторить проверку");
    }
  },
);

it("HTML экранирует данные и содержит только публичный DTO", async () => {
  mocks.verify.mockResolvedValue({
    number: certificateRecord.number,
    type: '<script>alert("x")</script>',
    fullName: "Соколова А. И.",
    issuedAt: certificateRecord.issuedAt,
    status: "valid",
  });
  const response = await verify(
    new Request("https://pulse.example/verify/code", {
      headers: { "x-forwarded-for": "192.0.2.4" },
    }),
    { params: Promise.resolve({ code: "code" }) },
  );
  const text = await response.text();
  expect(response.status).toBe(200);
  expectVerificationHeaders(response);
  expect(text).toContain("Соколова А. И.");
  expect(text).toContain("Справка действительна");
  expect(text).toContain(">5 ноября 2026 г.</time>");
  expect(text).toContain("&lt;script&gt;");
  expect(text).not.toContain("<script>");
  expect(text).not.toContain(certificateRecord.destination);
  expect(mocks.verify).toHaveBeenCalledWith({
    code: "code",
    ipHash: "ip-hash",
  });
  expect(mocks.ipHash).toHaveBeenCalledWith("192.0.2.4");
});
