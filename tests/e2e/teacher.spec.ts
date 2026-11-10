import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { moscowDate } from "../../src/domain/schedule/dates";
import { loginAs } from "../security/login";
import {
  loginAsTestTeacher,
  openTeacherTestData,
} from "../security/teacher-login";
import { conceptNotice } from "./shell-cases";

for (const theme of ["light", "dark"] as const) {
  test(`Мои пары: сегодня, неделя, своя навигация и axe · ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    await loginAs(page, "oleg");
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await expect(
      page.getByRole("heading", { name: "Мои пары", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /^Сегодня ·/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "На этой неделе", exact: true }),
    ).toBeVisible();
    const main = page.getByRole("main");
    await expect(main).toContainText("Политическая география");
    await expect(main).toContainText("Основы маркетинга");
    await expect(main).not.toContainText("Иностранный язык");
    await expect(main).not.toContainText("Номер зачётки");
    await expect(
      page.getByRole("button", { name: "Спросить или сделать", exact: true }),
    ).toHaveCount(0);
    const nav = page
      .getByRole("navigation", { name: "Основная навигация", exact: true })
      .filter({ visible: true });
    await expect(nav.getByRole("link")).toHaveCount(2);
    await expect(
      nav.getByRole("link", { name: "Мои пары", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("contentinfo")).toContainText(conceptNotice);
    await expect(page.getByRole("contentinfo")).toHaveCount(1);
    await expect(main.getByText(conceptNotice, { exact: true })).toHaveCount(0);
    if (page.viewportSize()?.width === 360) {
      const bar = page.locator(".mobile-navigation");
      const item = bar.getByRole("link", { name: "Мои пары", exact: true });
      expect((await item.boundingBox())?.width).toBeLessThan(
        ((await bar.boundingBox())?.width ?? 0) * 0.7,
      );
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const target of await page.locator("a,button").all()) {
      if (
        !(await target.isVisible()) ||
        (await target.getAttribute("class"))?.includes("skip-link")
      )
        continue;
      const box = await target.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(
        await target.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    }
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
}

test("кабинет временного преподавателя: пустые сегодня и неделя", async ({
  page,
}) => {
  test.skip(!process.env.DATABASE_URL, "Нужна БД тестового лейна.");
  const teacher = await openTeacherTestData();
  try {
    await teacher.sql`delete from schedule_slots where id = ${teacher.slotId}`;
    await loginAsTestTeacher(page, teacher.credentials);
    await expect(
      page.getByRole("heading", { name: "Сегодня пар нет", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "На этой неделе пар нет",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Обновить расписание", exact: true }),
    ).toBeVisible();
  } finally {
    await teacher.close();
  }
});

test("перенос и отмена своей пары приглушены и объяснены в карточке", async ({
  page,
}) => {
  test.skip(!process.env.DATABASE_URL, "Нужна БД тестового лейна.");
  const teacher = await openTeacherTestData();
  try {
    const [room] = await teacher.sql<
      { id: string }[]
    >`select id from rooms where seed_key = 'demo:room:1'`;
    if (!room) throw new Error("Нет учебной аудитории.");
    const date = moscowDate(new Date());
    await teacher.sql`insert into schedule_changes (id, slot_id, date, kind, new_date, new_starts_at, new_ends_at, new_room_id, reason)
      values (${teacher.ids.next()}, ${teacher.slotId}, ${date}, 'moved', ${date}, '13:00', '14:30', ${room.id}, 'Учебный перенос')`;
    await loginAsTestTeacher(page, teacher.credentials);
    const original = page
      .getByTestId("teacher-lesson")
      .filter({
        has: page.getByText("Перенесена → 13:00, ДЕМО-102", { exact: true }),
      })
      .first();
    await expect(original).toHaveAttribute("data-status", "moved-from");
    await expect(original.getByRole("heading")).toHaveCSS(
      "text-decoration-line",
      "line-through",
    );
    await expect(original.locator(".tabular-nums")).toHaveCSS(
      "text-decoration-line",
      "line-through",
    );
    await teacher.sql`insert into schedule_changes (id, slot_id, date, kind, reason, created_at)
      values (${teacher.ids.next()}, ${teacher.slotId}, ${date}, 'cancelled', 'Учебная отмена', now() + interval '1 second')`;
    await page.reload();
    const cancelled = page
      .locator('[data-testid="teacher-lesson"][data-status="cancelled"]')
      .first();
    await expect(
      cancelled.getByText("Отменена", { exact: true }),
    ).toBeVisible();
    await expect(cancelled.getByRole("heading")).toHaveCSS(
      "text-decoration-line",
      "line-through",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await teacher.close();
  }
});

test("BFLA в браузере: каждая роль и аноним на страницах трёх кабинетов", async ({
  page,
}) => {
  for (const role of ["anonymous", "anna", "marina", "oleg"] as const) {
    if (role !== "anonymous") await loginAs(page, role);
    for (const path of ["/today", "/staff/requests", "/teacher"]) {
      const response = await page.goto(path);
      if (role === "anonymous") await expect(page).toHaveURL(/\/login\?next=/);
      else if (path === "/today" && role !== "anna")
        await expect(page).toHaveURL(
          role === "oleg" ? /\/teacher$/ : /\/staff\/requests$/,
        );
      else if (
        (path === "/teacher" && role !== "oleg") ||
        (path === "/staff/requests" && role !== "marina")
      ) {
        expect(response?.status()).toBe(403);
        await expect(
          page.getByRole("heading", { name: "Доступ ограничен", exact: true }),
        ).toBeVisible();
      } else expect(response?.status()).toBe(200);
    }
  }
});
