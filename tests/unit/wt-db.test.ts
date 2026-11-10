import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("скрипт worktree проходит проверку shell и встроенного JavaScript", () => {
  const script = readFileSync(
    new URL("../../scripts/wt-db.sh", import.meta.url),
    "utf8",
  );
  expect(spawnSync("sh", ["-n", "scripts/wt-db.sh"]).status).toBe(0);
  const code = script.split("<<'NODE'\n")[1]?.split("\nNODE")[0];
  expect(code).toBeTruthy();
  expect(
    spawnSync(process.execPath, ["--check", "--input-type=module"], {
      input: code,
    }).status,
  ).toBe(0);
});

it("ID базы отклоняет посторонние символы до обращения к PostgreSQL", () => {
  for (const args of [
    [],
    ["42;select"],
    ["../42"],
    ["-1"],
    ["1234567890"],
    ["42", "43"],
  ]) {
    const result = spawnSync("sh", ["scripts/wt-db.sh", ...args], {
      env: {
        ...process.env,
        DATABASE_URL:
          "postgres://test:unprinted-test-password@127.0.0.1:1/test",
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ID/);
    expect(result.stdout + result.stderr).not.toContain(
      "unprinted-test-password",
    );
  }
});
