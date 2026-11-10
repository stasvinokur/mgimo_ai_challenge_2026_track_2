import { execFileSync } from "node:child_process";
import type { TestInfo } from "@playwright/test";

export async function attachCertificatePdfScreenshot(
  pdfPath: string,
  prefix: string,
  testInfo: Pick<TestInfo, "attach" | "annotations">,
) {
  try {
    execFileSync("pdftoppm", [
      "-f",
      "1",
      "-singlefile",
      "-scale-to",
      "1200",
      "-png",
      pdfPath,
      prefix,
    ]);
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
    testInfo.annotations.push({
      type: "Снимок PDF пропущен",
      description:
        "Утилита pdftoppm не установлена. Проверки содержимого PDF выполняются без Poppler.",
    });
    return;
  }
  await testInfo.attach("Первая страница PDF", {
    path: `${prefix}.png`,
    contentType: "image/png",
  });
}
