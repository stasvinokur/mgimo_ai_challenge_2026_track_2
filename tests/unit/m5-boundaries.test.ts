import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("depcruise не пускает серверные библиотеки в presentation, а браузерный WebAuthn — за пределы UI входа", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), "pulse-m5-boundaries-"));
  try {
    mkdirSync(join(directory, "src/ui/identity"), { recursive: true });
    symlinkSync(
      join(root, "node_modules"),
      join(directory, "node_modules"),
      "dir",
    );
    writeFileSync(
      join(directory, "src/ui/probe.ts"),
      'import "@simplewebauthn/server";\nimport "@simplewebauthn/browser";\nimport "web-push";\n',
    );
    writeFileSync(
      join(directory, "src/ui/identity/passkey-probe.ts"),
      'import "@simplewebauthn/browser";\n',
    );
    const require = createRequire(import.meta.url);
    const config = require(join(root, "dependency-cruiser.config.cjs"));
    config.options.tsConfig.fileName = join(root, "tsconfig.json");
    writeFileSync(join(directory, "config.json"), JSON.stringify(config));
    const result = spawnSync(
      process.execPath,
      [
        join(
          root,
          "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs",
        ),
        "--config",
        "config.json",
        "--output-type",
        "json",
        "src/ui/probe.ts",
        "src/ui/identity/passkey-probe.ts",
      ],
      { cwd: directory, encoding: "utf8" },
    );
    const report = JSON.parse(result.stdout);
    expect(result.status).toBe(0);
    expect(report.summary.error).toBe(3);
    const violations: { from: string; rule: { name: string } }[] =
      report.summary.violations;
    expect(
      violations.filter(
        (item) => item.rule.name === "presentation-no-auth-or-push-libraries",
      ),
    ).toHaveLength(2);
    expect(
      violations.filter(
        (item) => item.rule.name === "webauthn-browser-only-in-identity-ui",
      ),
    ).toHaveLength(1);
    expect(
      violations.filter((item) => item.from.startsWith("src/ui/identity/")),
    ).toHaveLength(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
