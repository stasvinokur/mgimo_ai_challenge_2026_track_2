import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture(dumpScript: string) {
  const root = mkdtempSync(join(tmpdir(), "pulse-backup-test-"));
  directories.push(root);
  mkdirSync(join(root, "bin"));
  const dump = join(root, "bin", "pg_dump");
  writeFileSync(dump, `#!/bin/sh\n${dumpScript}\n`);
  chmodSync(dump, 0o700);
  const destination = join(root, "backups");
  mkdirSync(destination);
  return {
    root,
    destination,
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` },
  };
}

it("сохраняет готовый дамп и удаляет только копии старше 7 дней", () => {
  const { destination, env } = fixture(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: POSIX shell parameter expansion.
    'for arg in "$@"; do case "$arg" in --file=*) printf dump > "${arg#--file=}";; esac; done',
  );
  const expired = join(destination, "pulse-expired.dump");
  const fresh = join(destination, "pulse-fresh.dump");
  writeFileSync(expired, "old");
  writeFileSync(fresh, "fresh");
  const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000);
  utimesSync(expired, past, past);
  execFileSync("sh", ["infra/backup.sh", destination], { env });
  expect(existsSync(expired)).toBe(false);
  expect(existsSync(fresh)).toBe(true);
  expect(readdirSync(destination)).toHaveLength(2);
  expect(readdirSync(destination).every((name) => name.endsWith(".dump"))).toBe(
    true,
  );
});

it("при отказе pg_dump удаляет неполный файл и сохраняет прежние копии", () => {
  const { destination, env } = fixture(
    // biome-ignore lint/suspicious/noTemplateCurlyInString: POSIX shell parameter expansion.
    'for arg in "$@"; do case "$arg" in --file=*) printf partial > "${arg#--file=}";; esac; done\nexit 1',
  );
  const previous = join(destination, "pulse-previous.dump");
  writeFileSync(previous, "valid");
  expect(() =>
    execFileSync("sh", ["infra/backup.sh", destination], {
      env,
      stdio: "pipe",
    }),
  ).toThrow();
  expect(readdirSync(destination)).toEqual(["pulse-previous.dump"]);
});
