import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { matchesGlob, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise } from "dependency-cruiser";
import { beforeAll, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
const dockerignore = readFileSync(resolve(root, ".dockerignore"), "utf8");
let modules: string[];
let buildModules: string[];

async function localImports(entries: string[]) {
  const { output } = await cruise(
    entries,
    {
      parser: "swc",
      tsConfig: { fileName: "tsconfig.json" },
      doNotFollow: { path: "node_modules" },
      outputType: "json",
    },
    {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
    },
  );
  if (typeof output !== "string")
    throw new Error("Ожидался JSON графа импортов.");
  const graph = JSON.parse(output) as {
    modules: {
      source: string;
      coreModule?: boolean;
      couldNotResolve?: boolean;
    }[];
  };
  expect(
    graph.modules
      .filter((item) => item.couldNotResolve)
      .map((item) => item.source),
  ).toEqual([]);
  return graph.modules
    .filter(
      (item) => !item.coreModule && !item.source.includes("node_modules/"),
    )
    .map((item) => item.source);
}

beforeAll(async () => {
  [modules, buildModules] = await Promise.all([
    localImports([
      "scripts/migrate.ts",
      "scripts/seed.ts",
      "scripts/demo-refresh.ts",
      "scripts/cleanup-identity.ts",
    ]),
    localImports(["src/app"]),
  ]);
});

function stage(text: string, name = "migrator") {
  const result = text
    .split(/^FROM /m)
    .find((part) =>
      new RegExp(`^\\S+\\s+AS\\s+${name}\\s*\\n`, "i").test(part),
    );
  if (!result) throw new Error(`Не найдена стадия ${name}.`);
  return result.replace(/\\\r?\n/g, " ");
}

function ignored(file: string, rules: string) {
  const parts = file.split("/");
  const ancestors = parts.map((_, index) =>
    parts.slice(0, index + 1).join("/"),
  );
  let excluded = false;
  for (const line of rules.split(/\r?\n/).map((rule) => rule.trim())) {
    if (!line || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    const pattern = (negated ? line.slice(1) : line)
      .replace(/^\//, "")
      .replace(/\/$/, "");
    if (
      (pattern.includes("/") ? ancestors : parts).some((part) =>
        matchesGlob(part, pattern),
      )
    )
      excluded = !negated;
  }
  return excluded;
}

function copied(
  file: string,
  text: string,
  rules = dockerignore,
  name = "migrator",
) {
  if (ignored(file, rules)) return false;
  const stages = [stage(text, name)];
  const visited = new Set([name]);
  for (let current = stages[0]; current; ) {
    const parent = current.split(/\s+/)[0];
    if (
      !parent ||
      visited.has(parent) ||
      !text
        .split(/^FROM /m)
        .some((part) =>
          new RegExp(`^\\S+\\s+AS\\s+${parent}\\s*\\n`, "i").test(part),
        )
    )
      break;
    visited.add(parent);
    current = stage(text, parent);
    stages.push(current);
  }
  for (const line of stages.flatMap((part) => part.split(/\r?\n/))) {
    if (!line.startsWith("COPY ")) continue;
    const tokens = line.trim().split(/\s+/).slice(1);
    const destination = tokens.pop();
    if (
      !destination ||
      tokens.some((token) => token.startsWith("--") || token.startsWith("["))
    )
      throw new Error(`Обновите проверку для нового синтаксиса COPY ${name}.`);
    for (const source of tokens) {
      const sourcePath = posix.normalize(source);
      const directory = statSync(resolve(root, sourcePath)).isDirectory();
      if (
        file !== sourcePath &&
        !(directory && file.startsWith(`${sourcePath}/`))
      )
        continue;
      const suffix = directory
        ? posix.relative(sourcePath, file)
        : destination.endsWith("/")
          ? posix.basename(sourcePath)
          : "";
      const target = posix.relative(
        "/app",
        posix.resolve("/app", destination, suffix),
      );
      if (target === file) return true;
    }
  }
  return false;
}

it("build включает транзитивные локальные импорты app с учётом deps и dockerignore", () => {
  expect(buildModules).toContain("src/application/identity/demo-accounts.ts");
  expect(buildModules).toContain("package.json");
  expect(
    [...buildModules, "tsconfig.json", "next.config.ts"].filter(
      (file) => !copied(file, dockerfile, dockerignore, "build"),
    ),
  ).toEqual([]);
});

it("проверка build обнаруживает импорт фикстур, неполный COPY и исключённый src", () => {
  expect(
    copied("scripts/fixtures/identity.ts", dockerfile, dockerignore, "build"),
  ).toBe(false);
  expect(
    copied(
      "src/application/identity/demo-accounts.ts",
      dockerfile.replaceAll("COPY src ./src", "COPY src ./elsewhere"),
      dockerignore,
      "build",
    ),
  ).toBe(false);
  expect(
    copied(
      "src/application/identity/demo-accounts.ts",
      dockerfile,
      `${dockerignore}\nsrc/application/identity`,
      "build",
    ),
  ).toBe(false);
});

it("migrator включает транзитивные локальные импорты четырёх скриптов и tsconfig для @/", () => {
  expect(modules).toContain(
    "src/infrastructure/auth/argon2-password-hasher.ts",
  );
  expect(modules).toContain("src/application/ports/password-hasher.ts");
  expect(
    [...modules, "tsconfig.json"].filter((file) => !copied(file, dockerfile)),
  ).toEqual([]);
  expect(copied("scripts/spikes/assistant/run.js", dockerfile)).toBe(false);
});

it("проверка обнаруживает прежний неполный COPY и исключение зависимости через dockerignore", () => {
  const previous =
    "FROM deps AS migrator\nCOPY scripts/migrate.ts scripts/seed.ts scripts/demo-refresh.ts ./scripts/\nCOPY src/infrastructure/db ./src/infrastructure/db\n";
  const missing = modules.filter((file) => !copied(file, previous));
  expect(missing).toContain(
    "src/infrastructure/auth/argon2-password-hasher.ts",
  );
  expect(missing).toContain("scripts/fixtures/student.ts");
  expect(
    copied(
      "src/infrastructure/auth/argon2-password-hasher.ts",
      dockerfile,
      `${dockerignore}\nsrc/infrastructure/auth`,
    ),
  ).toBe(false);
  expect(
    copied(
      "src/infrastructure/db/client.ts",
      dockerfile.replaceAll("COPY src ./src", "COPY src ./elsewhere"),
    ),
  ).toBe(false);
});

it("read-only сервисы используют /tmp, а tsx действительно пишет кэш только в разрешённый временный каталог", () => {
  expect(stage(dockerfile)).toMatch(/^ENV TMPDIR=\/tmp$/m);
  const compose = readFileSync(resolve(root, "compose.yaml"), "utf8");
  for (const name of ["migrate", "scheduler"]) {
    const service = compose
      .split(/^ {2}(?=[a-z]+:)/m)
      .find((block) => block.startsWith(`${name}:`));
    expect(service).toMatch(/^ {4}read_only: true$/m);
    expect(service).toMatch(/^ {4}tmpfs: \[\/tmp(?:, [^\]]+)?\]$/m);
  }
  const directory = mkdtempSync("/tmp/pulse-migrator-test-");
  const cache = resolve(directory, "tmp");
  try {
    mkdirSync(cache);
    cpSync(resolve(root, "tsconfig.json"), resolve(directory, "tsconfig.json"));
    const clock = "src/infrastructure/system/clock.ts";
    mkdirSync(resolve(directory, "src/infrastructure/system"), {
      recursive: true,
    });
    cpSync(resolve(root, clock), resolve(directory, clock));
    const entry = resolve(directory, "cache-check.mts");
    writeFileSync(
      entry,
      'import { SystemClock } from "@/infrastructure/system/clock"; console.info(new SystemClock().now() instanceof Date);',
    );
    const require = createRequire(import.meta.url);
    const result = spawnSync(
      process.execPath,
      [
        "--permission",
        "--allow-fs-read=*",
        `--allow-fs-write=${cache}`,
        "--allow-worker",
        "--allow-child-process",
        "--import",
        require.resolve("tsx"),
        entry,
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          TMPDIR: cache,
          TSX_TSCONFIG_PATH: resolve(directory, "tsconfig.json"),
          TSX_DISABLE_CACHE: "",
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("true");
    const cacheDirectories = readdirSync(cache).filter((name) =>
      name.startsWith("tsx-"),
    );
    expect(cacheDirectories.length).toBeGreaterThan(0);
    expect(
      cacheDirectories.some(
        (name) => readdirSync(resolve(cache, name)).length > 0,
      ),
    ).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
