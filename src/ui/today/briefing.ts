import type { Lesson, LessonChange } from "@/application/schedule/get-schedule";
import type { TodayAction, TodayDto } from "@/application/today/get-today";
import { briefingMessages } from "@/ui/i18n/dictionaries/today";
import { formatNumber } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";
import type { RussianDayCase } from "@/ui/i18n/russian-numbers";
import { t } from "@/ui/i18n/translate";
import { actionPresentation } from "./action-label";
import { briefingSpokenText } from "./briefing-text";
import {
  localizedCountdown,
  requestStatus,
  sameMoscowDate,
  scholarshipHeadline,
  todayDate,
  todayTime,
} from "./format";

function unit(language: Language, value: number, kind: "debt" | "change") {
  const form = new Intl.PluralRules(
    language === "en" ? "en-GB" : "ru-RU",
  ).select(value);
  const suffix = form === "one" ? "One" : form === "few" ? "Few" : "Many";
  return t(language, briefingMessages, `${kind}${suffix}`);
}

function sentence(text: string) {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

function active(lesson: Lesson) {
  return lesson.status === "scheduled" || lesson.status === "moved-to";
}

function repeatsChange(action: TodayAction, change: LessonChange, now: string) {
  const message = action.message;
  if (
    change.kind !== "moved" ||
    message.code !== "notification" ||
    action.href.split(/[?#]/, 1)[0] !== "/schedule" ||
    message.title !== "Пара перенесена"
  )
    return false;
  // Preserve exact deduplication of stored notice data; never infer a translation.
  const dates = [todayDate(change.after.startsAt)];
  if (sameMoscowDate(change.after.startsAt, now)) dates.push("Сегодня");
  return dates.some(
    (date) =>
      message.body ===
      `${date}: занятие перенесено на ${todayTime(change.after.startsAt)}, аудитория ${change.after.room}.`,
  );
}

export interface BriefingPhrase {
  visible: string;
  spoken: string;
}

export function buildTodayBriefingForms(
  data: TodayDto,
  now: string,
  language: Language = "ru",
): BriefingPhrase[] {
  const phrases: BriefingPhrase[] = [];
  function message(
    key: keyof typeof briefingMessages,
    params: Record<string, string | BriefingPhrase>,
  ): BriefingPhrase {
    function render(form: keyof BriefingPhrase) {
      return t(
        language,
        briefingMessages,
        key,
        Object.fromEntries(
          Object.entries(params).map(([name, value]) => [
            name,
            typeof value === "string" ? value : value[form],
          ]),
        ),
      );
    }
    return { visible: render("visible"), spoken: render("spoken") };
  }
  function dateForms(
    value: string,
    grammaticalCase: RussianDayCase,
    withTime = false,
  ): BriefingPhrase {
    const visible = todayDate(value, withTime, language);
    return {
      visible,
      spoken: briefingSpokenText(visible, language, grammaticalCase),
    };
  }
  function append(value: string | BriefingPhrase) {
    const phrase =
      typeof value === "string" ? { visible: value, spoken: value } : value;
    phrases.push({
      visible: phrase.visible,
      spoken: briefingSpokenText(phrase.spoken, language),
    });
  }
  let describedChange: LessonChange | undefined;
  if (data.schedule.ok) {
    const schedule = data.schedule.data;
    const lessons = [
      ...schedule.lessons,
      ...(schedule.next ? [schedule.next] : []),
    ]
      .filter(active)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const current = lessons.find(
      (lesson) =>
        Date.parse(lesson.startsAt) <= Date.parse(now) &&
        Date.parse(lesson.endsAt) > Date.parse(now),
    );
    const next = lessons.find(
      (lesson) => Date.parse(lesson.startsAt) > Date.parse(now),
    );
    if (current) {
      append(
        t(language, briefingMessages, "current", {
          course: current.course,
          time: todayTime(current.endsAt, language),
          room: current.room,
        }),
      );
    } else {
      if (!schedule.lessons.some(active))
        append(t(language, briefingMessages, "noClasses"));
      else if (!next || next.date !== schedule.date)
        append(t(language, briefingMessages, "classesFinished"));
      if (next) {
        append(
          t(language, briefingMessages, "next", {
            when: localizedCountdown(next.startsAt, now, language, true),
            course: next.course,
            room: next.room,
            zone:
              next.date !== schedule.date
                ? t(language, briefingMessages, "timeZone")
                : "",
          }),
        );
      }
    }
    // A move appears twice in the DTO: at its old and new positions.
    const changes = [
      ...new Map(
        schedule.changes.flatMap((lesson) =>
          lesson.changes.map(
            (change) => [change.id, { lesson, change }] as const,
          ),
        ),
      ).values(),
    ];
    const first = changes[0];
    if (first) {
      const { lesson, change } = first;
      describedChange = change;
      const extra =
        changes.length > 1
          ? t(language, briefingMessages, "extraChanges", {
              count: formatNumber(language, changes.length - 1),
              unit: unit(language, changes.length - 1, "change"),
            })
          : "";
      const changedDate = dateForms(change.after.startsAt, "accusative");
      const detail = message(change.kind, {
        date: sameMoscowDate(change.after.startsAt, now)
          ? ""
          : {
              visible: `${changedDate.visible}, `,
              spoken: `${changedDate.spoken}, `,
            },
        time: todayTime(change.after.startsAt, language),
        room: change.after.room,
        teacher: change.after.teacher,
      });
      append(message("change", { course: lesson.course, detail, extra }));
    }
  }

  const action = data.actions.find(
    (item) =>
      (item.section === "grades" ? data.study.ok : data[item.section].ok) &&
      !(describedChange && repeatsChange(item, describedChange, now)),
  );
  const debt = data.study.ok ? data.study.data.summary.openDebts : 0;
  const debtInAction =
    debt > 0 &&
    action?.message.code === "course" &&
    action.message.state === "debt";
  if (action) {
    const title = actionPresentation(action, language).title;
    const main = message("main", {
      title:
        language === "en" && action.message.code === "notification"
          ? `“${title}”`
          : title,
      deadline: action.dueAt
        ? message("deadline", {
            date: dateForms(action.dueAt, "nominative", true),
          })
        : "",
    });
    append({ visible: sentence(main.visible), spoken: sentence(main.spoken) });
  } else if (
    !data.actions.length &&
    data.study.ok &&
    data.requests.ok &&
    data.notifications.ok
  ) {
    append(t(language, briefingMessages, "noUrgent"));
  }

  if (data.study.ok) {
    const { scholarship, session } = data.study.data;
    if (debt > 0 && !debtInAction) {
      append(
        t(language, briefingMessages, "debt", {
          count: formatNumber(language, debt),
          unit: unit(language, debt, "debt"),
        }),
      );
    } else if (debt === 0) {
      append(sentence(scholarshipHeadline(scholarship, language)));
    } else if (session) {
      append(
        message("session", {
          date: dateForms(session.at, "genitive"),
          time: todayTime(session.at, language),
        }),
      );
    }
  }

  if (phrases.length < 3 && data.requests.ok && data.requests.data.active[0]) {
    const request = data.requests.data.active[0];
    append(
      sentence(
        t(language, briefingMessages, "request", {
          title: request.title,
          status: requestStatus(request.status, language).toLocaleLowerCase(
            language === "en" ? "en-GB" : "ru-RU",
          ),
        }),
      ),
    );
  }
  return phrases.slice(0, 5);
}

export function buildTodayBriefing(
  data: TodayDto,
  now: string,
  language: Language = "ru",
): string[] {
  return buildTodayBriefingForms(data, now, language).map(
    (phrase) => phrase.visible,
  );
}
