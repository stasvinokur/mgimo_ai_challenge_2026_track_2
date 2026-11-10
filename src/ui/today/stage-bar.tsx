import { todayMessages } from "@/ui/i18n/dictionaries/today";
import { formatNumber } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";
import { type SemanticTone, StageBar } from "@/ui/primitives/stage-bar";

export function TodayStageBar({
  total,
  current,
  tone,
  language,
}: {
  total: number;
  current: number;
  tone: SemanticTone;
  language: Language;
}) {
  return (
    <div
      role="img"
      aria-label={t(language, todayMessages, "stage", {
        stage: formatNumber(language, current),
        total: formatNumber(language, total),
      })}
    >
      <div aria-hidden="true">
        <StageBar total={total} current={current} tone={tone} />
      </div>
    </div>
  );
}
