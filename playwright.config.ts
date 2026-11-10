import { defineConfig, devices } from "@playwright/test";

const port = process.env.PORT || "3000";
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL || `http://127.0.0.1:${port}`;
const publicLoginPort = String(Number(port) + 10_000);
const publicLoginURL =
  process.env.PLAYWRIGHT_PUBLIC_LOGIN_URL ||
  `http://localhost:${publicLoginPort}`;
const publicLoginSpec = "tests/e2e/login-public.spec.ts";
const basePathSpec = "tests/e2e/base-path.spec.ts";

export default defineConfig({
  testDir: ".",
  testMatch: ["tests/e2e/**/*.spec.ts", "tests/security/**/*.spec.ts"],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  // Reduced motion disables CSS transitions (globals.css), so axe never sees a button mid-fade.
  use: {
    baseURL,
    trace: "retain-on-failure",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "mobile-360",
      testIgnore: [publicLoginSpec, basePathSpec],
      use: {
        ...devices["Desktop Chrome"],
        locale: "ru-RU",
        viewport: { width: 360, height: 740 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "desktop",
      testIgnore: [publicLoginSpec, basePathSpec],
      use: { ...devices["Desktop Chrome"], locale: "ru-RU" },
    },
    ...(externalBaseURL && !process.env.PLAYWRIGHT_PUBLIC_LOGIN_URL
      ? []
      : ["mobile-360", "desktop"]
    ).map((name) => ({
      name: `login-off-${name}`,
      testMatch: publicLoginSpec,
      use: {
        ...devices["Desktop Chrome"],
        locale: "ru-RU",
        baseURL: publicLoginURL,
        ...(name === "mobile-360"
          ? {
              viewport: { width: 360, height: 740 },
              isMobile: true,
              hasTouch: true,
            }
          : {}),
      },
    })),
  ],
  webServer: externalBaseURL
    ? undefined
    : [
        {
          command: "pnpm build && pnpm start",
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          // The first server finishes the only build before this one starts.
          command: "pnpm start",
          url: publicLoginURL,
          env: {
            PORT: publicLoginPort,
            APP_ORIGIN: publicLoginURL,
            DEMO_LOGIN_HINTS: "off",
          },
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
