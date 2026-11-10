import { cn } from "./utils";

export type SemanticTone = "success" | "warning" | "danger" | "info";

export function StageBar({
  total,
  current,
  tone = "success",
  className,
}: {
  total: number;
  current: number;
  tone?: SemanticTone;
  className?: string;
}) {
  const count = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const stage = Number.isFinite(current)
    ? Math.min(count, Math.max(0, Math.floor(current)))
    : 0;
  return (
    <div
      className={cn("stage-bar", `tone-${tone}`, className)}
      role="img"
      aria-label={`этап ${stage} из ${count}`}
    >
      {Array.from({ length: count }, (_, index) => index + 1).map((number) => (
        <span key={number} aria-hidden="true" data-complete={number <= stage} />
      ))}
    </div>
  );
}
