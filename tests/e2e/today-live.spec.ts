import { expect, loginAsTestStudent, test } from "../security/student-login";
import { openTodaySchedule } from "./today-data";

test("пульс: отсчёт и отметка сейчас обновляются за минуту без навигации", async ({
  page,
  students,
}) => {
  const student = await students.get("anna");
  const schedule = await openTodaySchedule(student.actor.studentId);
  try {
    // Keep timers running through login, navigation and hydration.
    await page.clock.install();
    await loginAsTestStudent(page, student.credentials);
    const pulse = page.getByTestId("day-pulse");
    const countdown = pulse.getByRole("status");
    await expect(countdown).toBeVisible();
    const marker = pulse.locator(".day-timeline-now circle").first();
    // The SVG is created by a client effect, not by the server render.
    await expect(marker).toBeVisible();
    const initial = new Date(schedule.startsAt.getTime() - 5 * 60_000);
    await page.clock.pauseAt(initial);
    await expect(countdown).toHaveText("Через 5 мин");
    const now = page.getByTestId("pulse-now");
    await expect(now).toHaveAttribute("datetime", initial.toISOString());
    const before = Number(await marker.getAttribute("cx"));
    const afterDay = (
      await pulse.locator(".day-timeline p").textContent()
    )?.includes("после конца дня");
    await page.clock.runFor(60_000);
    await expect(countdown).toHaveText("Через 4 мин");
    await expect(now).toHaveAttribute(
      "datetime",
      new Date(initial.getTime() + 60_000).toISOString(),
    );
    if (afterDay) {
      // Near midnight the server's day has ended; the marker stays at its edge.
      await expect(marker).toHaveAttribute("cx", String(before));
    } else {
      await expect
        .poll(async () => Number(await marker.getAttribute("cx")))
        .toBeGreaterThan(before);
    }
    await expect(page).toHaveURL(/\/today$/);
  } finally {
    await schedule.close();
  }
});
