import { expect, it, vi } from "vitest";
import {
  absoluteAppUrl,
  appPath,
  appStorageName,
} from "@/application/shared/app-path.mjs";
import { internalRegulationUrl } from "@/ui/regulations/markdown";

it.each([
  "/../x",
  "/%2e%2e/x",
  "/%2E%2e/x",
  "/%2e%2E/x",
  "/.%2E/x",
  "/%2e./x",
  "/a/../../x",
])("markdown не уводит к соседу после нормализации: %s", (path) => {
  vi.stubEnv("BASE_PATH", "/dekanat");
  expect(internalRegulationUrl(path)).toBeUndefined();
});
it("markdown сохраняет безопасные ссылки и нормализует внутри папки", () => {
  vi.stubEnv("BASE_PATH", "/dekanat");
  expect(internalRegulationUrl("/a/../regulations?q=1#p-2")).toBe(
    "/dekanat/regulations?q=1#p-2",
  );
  expect(internalRegulationUrl("#p-2")).toBe("#p-2");
  expect(internalRegulationUrl("//neighbor.example/x")).toBeUndefined();
});
it("application использует только переданный параметр, независимо от env", () => {
  vi.stubEnv("BASE_PATH", "/neighbor");
  expect(appPath("/today")).toBe("/today");
  expect(appPath("/today", "/dekanat")).toBe("/dekanat/today");
  expect(absoluteAppUrl("https://pulse.example", "/verify/a", "/dekanat")).toBe(
    "https://pulse.example/dekanat/verify/a",
  );
  expect(appStorageName("pulse-install-dismissed", "/dekanat")).toBe(
    "pulse-install-dismissed-dekanat",
  );
});
