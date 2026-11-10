import type { TestInfo } from "@playwright/test";
import { expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync: run }));

import { attachCertificatePdfScreenshot } from "../e2e/certificates-pdf-screenshot";

function info() {
  return {
    annotations: [] as TestInfo["annotations"],
    attach: vi.fn(async () => {}),
  };
}

it("без Poppler пропускает только снимок с аннотацией, не весь тест", async () => {
  run.mockImplementationOnce(() => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  });
  const testInfo = info();
  await expect(
    attachCertificatePdfScreenshot("certificate.pdf", "first-page", testInfo),
  ).resolves.toBeUndefined();
  expect(testInfo.annotations).toEqual([
    {
      type: "Снимок PDF пропущен",
      description:
        "Утилита pdftoppm не установлена. Проверки содержимого PDF выполняются без Poppler.",
    },
  ]);
  expect(testInfo.attach).not.toHaveBeenCalled();
});

it("ошибку рендера установленной утилиты не скрывает", async () => {
  const error = Object.assign(new Error("render failed"), { status: 1 });
  run.mockImplementationOnce(() => {
    throw error;
  });
  const testInfo = info();
  await expect(
    attachCertificatePdfScreenshot("certificate.pdf", "first-page", testInfo),
  ).rejects.toBe(error);
  expect(testInfo.annotations).toEqual([]);
});
