import type { Route } from "@playwright/test";
import { PAGE_CACHE_PREFIX } from "../../src/ui/shell/pwa-cache";
import { expect, test } from "../security/student-login";

test.use({ serviceWorkers: "allow" });

for (const failures of [1, 2]) {
  test(`SW возвращает копию при navigator.onLine=true (${failures} отказа fetch), затем страница восстанавливается без online`, async ({
    page,
    context,
    loginAs,
  }) => {
    await loginAs("anna");
    await expect
      .poll(
        () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          page.evaluate(async (prefix) => {
            const names = (await caches.keys()).filter((name) =>
              name.startsWith(prefix),
            );
            for (const name of names) {
              if (await (await caches.open(name)).match("/today")) return true;
            }
            return false;
          }, PAGE_CACHE_PREFIX),
        { timeout: 20_000 },
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            performance.getEntriesByType("resource").some((entry) => {
              const resource = entry as PerformanceResourceTiming;
              return (
                new URL(resource.name).pathname === "/today" &&
                resource.initiatorType === "fetch" &&
                resource.workerStart > 0 &&
                resource.responseEnd > 0
              );
            }),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    const release = Promise.withResolvers<void>();
    let attempts = 0;
    async function intercept(route: Route) {
      const request = route.request();
      if (
        !request.serviceWorker() ||
        !request.headers().accept?.includes("text/html")
      )
        return route.continue();
      if (++attempts <= failures) return route.abort("internetdisconnected");
      await release.promise;
      return route.continue();
    }
    await context.route("**/today", intercept);
    try {
      // Only SW's network fails; the document is already online and receives no online event.
      await page.reload();
      await expect(page.locator("[data-pwa-offline]")).toBeVisible();
      expect(await page.evaluate(() => navigator.onLine)).toBe(true);
      await expect.poll(() => attempts).toBe(failures + 1);
      release.resolve();
      await expect(page.locator("[data-pwa-offline]")).toHaveCount(0);
      await expect(page.locator("html")).not.toHaveAttribute(
        "data-pwa-saved-at",
      );
      await expect(
        page.getByRole("heading", { name: "Сейчас", exact: true }),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/today$/);
    } finally {
      release.resolve();
      await context.unroute("**/today", intercept);
    }
  });
}
