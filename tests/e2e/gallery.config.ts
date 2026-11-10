import { defineConfig, devices } from "@playwright/test";

const serverURL = new URL(
  process.env.PLAYWRIGHT_BASE_URL ||
    `http://localhost:${process.env.PORT || "3000"}`,
);
// WebAuthn and the browser's Origin must use the same host as APP_ORIGIN.
if (["127.0.0.1", "[::1]"].includes(serverURL.hostname))
  serverURL.hostname = "localhost";
const baseURL = serverURL.origin;

if (!process.env.PLAYWRIGHT_BASE_URL) process.env.ASSISTANT_RUNTIME = "mock";

export default defineConfig({
  testDir: ".",
  testMatch: "gallery.ts",
  tsconfig: "../../tsconfig.json",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  outputDir: "../../test-results/gallery",
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
  },
  projects: [
    {
      name: "360",
      use: {
        viewport: { width: 360, height: 740 },
        isMobile: true,
        hasTouch: true,
      },
    },
    { name: "1440", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm build && pnpm start",
        cwd: "../..",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 180_000,
        env: { ASSISTANT_RUNTIME: "mock", APP_ORIGIN: baseURL },
      },
});
