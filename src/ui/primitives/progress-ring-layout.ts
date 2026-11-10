const formatNumber = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 1,
});

export function calculateProgressRing(
  value: number | null | undefined,
  goal: number,
) {
  const safeGoal = Number.isFinite(goal) ? Math.max(0, goal) : 0;
  const hasValue = typeof value === "number" && Number.isFinite(value);
  const safeValue = hasValue ? Math.min(safeGoal, Math.max(0, value)) : 0;
  const ratio = safeGoal > 0 ? safeValue / safeGoal : 0;
  const valueLabel = hasValue
    ? formatNumber.format(value)
    : value == null
      ? "Нет данных"
      : "—";
  const goalLabel = formatNumber.format(safeGoal);
  const circumference = 2 * Math.PI * 30;
  return {
    value: safeValue,
    goal: safeGoal,
    ratio,
    circumference,
    offset: circumference * (1 - ratio),
    valueLabel,
    goalLabel,
    accessibleName: `${valueLabel} из ${goalLabel}`,
  };
}
