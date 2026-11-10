import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { GetCourseActions } from "@/application/grades/get-course-actions";
import { courseActions } from "@/domain/grades/course-actions";
import { getCourseAssistantQuestion } from "@/ui/grades/assistant-question";
import { CourseActions } from "@/ui/grades/course-actions";
import { subscribeAssistantEntry } from "@/ui/shell/assistant-entry";
import { gradesFixture } from "../fakes/grades";

const language = vi.hoisted(() => ({ value: "ru" as "ru" | "en" }));

vi.mock("@/ui/i18n/language-provider", () => ({
  useLanguage: () => language.value,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: vi.fn(),
  useState: (initial: unknown) => [initial, vi.fn()],
}));

afterEach(() => {
  language.value = "ru";
  vi.unstubAllGlobals();
});

function clickAssistant(node: ReactNode, label: string): boolean {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(child))
      continue;
    if (child.props.children === label) {
      child.props.onClick?.();
      return true;
    }
    if (clickAssistant(child.props.children, label)) return true;
  }
  return false;
}

it.each(["ru", "en"] as const)(
  "варианты %s открывают форму по id и передают переведённый вопрос единой шторке",
  async (selectedLanguage) => {
    language.value = selectedLanguage;
    const d = gradesFixture();
    const courseId = d.ctx.row("course:imp:0").id;
    const plan = await new GetCourseActions(d.repository, d.clock).execute(
      d.timur,
      { courseId },
    );
    if (!plan) throw new Error("Нужен план действий.");
    const html = renderToStaticMarkup(
      createElement(CourseActions, { plan, expanded: true }),
    );
    expect(html).toContain(
      selectedLanguage === "ru"
        ? `<span class="sr-only"> по дисциплине «${plan.courseTitle}»</span>`
        : `<span class="sr-only"> for “${plan.courseTitle}”</span>`,
    );
    expect(html).toContain(
      `href="/requests/new?type=question&amp;courseId=${courseId}&amp;workId=${plan.workId}"`,
    );
    expect(html).not.toContain("aria-label=");
    expect(html).not.toContain("<form");
    vi.stubGlobal("window", new EventTarget());
    const opened = vi.fn();
    const unsubscribe = subscribeAssistantEntry(opened);
    try {
      expect(opened).not.toHaveBeenCalled();
      expect(
        clickAssistant(
          CourseActions({ plan, expanded: true }),
          selectedLanguage === "ru"
            ? "Обсудить с ассистентом"
            : "Discuss with the assistant",
        ),
      ).toBe(true);
      expect(opened).toHaveBeenCalledExactlyOnceWith(
        getCourseAssistantQuestion(plan, selectedLanguage),
      );
      expect(opened.mock.calls[0]?.[0]).toContain(
        selectedLanguage === "ru" ? "28,8 из 100" : "28.8 out of 100",
      );
      expect(plan.appeal.question).toContain("Вопрос по дисциплине");
    } finally {
      unsubscribe();
      vi.unstubAllGlobals();
    }
  },
);

it.each(["overdue", "upcoming", "graded"] as const)(
  "русский вопрос для %s сохраняет исходный текст, English переводит только подписи",
  async (scenario) => {
    const d = gradesFixture();
    const record = d.records.get(d.ctx.row("student:timur").id);
    const course = record?.courses[0];
    if (!record || !course) throw new Error("Нужна дисциплина.");
    if (scenario === "graded") for (const work of course.works) work.score = 1;
    if (scenario === "upcoming")
      for (const work of course.works)
        if (work.score === null) work.dueAt = "2026-11-12T12:00:00.000Z";
    const original = courseActions(
      course,
      record.targetScore,
      d.clock.now().toISOString(),
    );
    const plan = await new GetCourseActions(d.repository, d.clock).execute(
      d.timur,
      { courseId: course.id },
    );
    if (!original || !plan) throw new Error("Нужен план действий.");
    expect(getCourseAssistantQuestion(plan, "ru")).toBe(
      original.assistantQuestion,
    );
    const english = getCourseAssistantQuestion(plan, "en");
    expect(english).toContain(
      `What can I do for the course «${course.title}»?`,
    );
    expect(english).toContain("Current total without new scores:");
    expect(english).toContain(
      "Help me make an action plan and explain the options.",
    );
    expect(english).not.toContain("Что можно сделать");
    expect(english).not.toContain("Текущий итог");
    if (scenario === "graded") {
      expect(english).toContain(
        "All assignments in this course have been graded",
      );
      expect(english).not.toContain("Deadline:");
    } else {
      expect(english).toContain(
        `Assignment: «${plan.assistantContext.workTitle}»`,
      );
      expect(english).toContain("Deadline:");
      expect(english.includes("The deadline has passed.")).toBe(
        scenario === "overdue",
      );
    }
  },
);
