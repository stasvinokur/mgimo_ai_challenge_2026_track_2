import { describe, expect, it } from "vitest";
import { canGradeReplacement, scoreChange } from "@/domain/grades/score-change";
import {
  reasonCodes,
  reasonLabel,
  reasonOptions,
} from "@/domain/grades/score-reasons";
import { ValidationError } from "@/domain/shared/errors";

const initial = { score: 0, maxScore: 100, previousScore: null };

describe("выставление и изменение балла", () => {
  it("разрешает целые границы, ноль остаётся выставленным баллом", () => {
    expect(scoreChange(initial)).toEqual({ changed: true, reason: null });
    expect(scoreChange({ ...initial, score: 100 }).changed).toBe(true);
    expect(scoreChange({ ...initial, previousScore: 0 })).toEqual({
      changed: false,
      reason: null,
    });
    expect(() =>
      scoreChange({ ...initial, previousScore: 0, score: 1 }),
    ).toThrow(ValidationError);
  });

  it.each([-1, 101, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "отклоняет недопустимый балл %s",
    (score) => {
      expect(() => scoreChange({ ...initial, score })).toThrow(ValidationError);
    },
  );

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "проверяет максимум %s",
    (maxScore) => {
      expect(() => scoreChange({ ...initial, maxScore })).toThrow(
        ValidationError,
      );
    },
  );

  it.each(reasonCodes)("разрешает закрытый код причины %s", (reason) => {
    expect(
      scoreChange({ ...initial, previousScore: 80, score: 90, reason }),
    ).toEqual({ changed: true, reason });
    expect(scoreChange({ ...initial, reason }).reason).toBe(reason);
  });

  it.each(["", " ", "Перепроверена работа", "retake ", "other"])(
    "домен отклоняет произвольную причину %j даже для первого балла",
    (reason) => {
      expect(() => scoreChange({ ...initial, reason })).toThrow(
        ValidationError,
      );
    },
  );

  it("причина обязательна при изменении, no-op остаётся без события", () => {
    expect(() =>
      scoreChange({ ...initial, previousScore: 80, score: 90 }),
    ).toThrow(ValidationError);
    expect(scoreChange({ ...initial, score: 80, previousScore: 80 })).toEqual({
      changed: false,
      reason: null,
    });
  });

  it("подписи не раскрывают старую свободную причину", () => {
    expect(reasonOptions.map((option) => option.code)).toEqual(reasonCodes);
    expect(reasonLabel("appeal_review")).toBe("Пересмотр после апелляции");
    expect(reasonLabel("entry_error")).toBe("Исправление ошибки ввода");
    expect(reasonLabel("retake")).toBe("Пересдача");
    expect(reasonLabel("excused")).toBe("Уважительная причина");
    expect(reasonLabel("late_submission")).toBe("Работа сдана позже");
    expect(reasonLabel(null)).toBeNull();
    expect(reasonLabel("Старый произвольный текст")).toBe("Причина уточняется");
  });

  it.each([
    ["2026-11-04", false],
    ["2026-11-05", true],
    ["2026-11-11", true],
    ["2026-11-12", false],
    ["2027-01-01", false],
  ] as const)("окно замены для 5 ноября: %s → %s", (today, allowed) => {
    expect(canGradeReplacement("2026-11-05", today)).toBe(allowed);
  });

  it("окно замены проходит через границу месяца и года", () => {
    expect(canGradeReplacement("2026-12-29", "2027-01-04")).toBe(true);
    expect(canGradeReplacement("2026-12-29", "2027-01-05")).toBe(false);
  });
});
