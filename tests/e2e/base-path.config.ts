import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const port = String(Number(process.env.PORT || "3000") + 20_000);
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: ".",
  globalSetup: "../integration/global-setup.ts",
  testMatch: "base-path.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: {
    baseURL: origin,
    locale: "ru-RU",
    trace: "retain-on-failure",
    reducedMotion: "reduce",
    serviceWorkers: "allow",
  },
  projects: [
    {
      name: "base-path-mobile-360",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 360, height: 740 },
        isMobile: true,
        hasTouch: true,
      },
    },
    { name: "base-path-desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    command: "node tests/e2e/base-path-server.mjs",
    url: `${origin}/dekanat/login`,
    env: { PORT: port, APP_ORIGIN: origin, ASSISTANT_RUNTIME: "mock" },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
