import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";

it("в корне приложения нет loading-границы над всеми маршрутами", () => {
  for (const extension of ["tsx", "jsx", "ts", "js"]) {
    expect(existsSync(resolve(`src/app/loading.${extension}`))).toBe(false);
  }
});

it("loading преподавателя изолирован главной и не охватывает будущие страницы пар", () => {
  expect(
    existsSync(resolve("src/app/(teacher)/teacher/(home)/loading.tsx")),
  ).toBe(true);
  for (const path of ["src/app/(teacher)", "src/app/(teacher)/teacher"]) {
    for (const extension of ["tsx", "jsx", "ts", "js"])
      expect(existsSync(resolve(`${path}/loading.${extension}`))).toBe(false);
  }
});

for (const group of ["student", "staff", "teacher", "attend"]) {
  const root = resolve(
    group === "attend" ? "src/app/attend" : `src/app/(${group})`,
  );
  const pages = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
    (file) =>
      /(?:^|\/)page\.(?:tsx?|jsx?)$/.test(file) &&
      file.split("/").some((segment) => /\[.+\]/.test(segment)),
  );

  for (const page of pages) {
    it(`${group}/${page}: проверка доступа завершается до loading-границы`, () => {
      const boundaries: string[] = [];
      let directory = dirname(page);
      for (;;) {
        for (const extension of ["tsx", "jsx", "ts", "js"]) {
          const loading = join(directory, `loading.${extension}`);
          if (existsSync(resolve(root, loading))) boundaries.push(loading);
        }
        if (directory === ".") break;
        directory = dirname(directory);
      }
      expect(
        boundaries,
        "Loading над динамической страницей начинает стриминг до проверки доступа и меняет HTTP 404/403 на 200.",
      ).toEqual([]);
    });
  }
}
