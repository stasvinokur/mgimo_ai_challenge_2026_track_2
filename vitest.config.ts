import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const hasDatabase = Boolean(process.env.DATABASE_URL);

if (!hasDatabase) {
  console.info(
    "DATABASE_URL не задан: integration-тесты пропущены. Unit и application выполняются без БД.",
  );
}

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    restoreMocks: true,
    unstubEnvs: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "tests/spikes/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "application",
          environment: "node",
          include: ["tests/application/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          fileParallelism: false,
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          include: ["tests/integration/**/*.test.ts"],
          exclude: hasDatabase ? [] : ["**/*"],
        },
      },
    ],
  },
});
