import Link from "next/link";
import type { SemanticTone } from "./stage-bar";
import { cn } from "./utils";

export function CounterTile({
  value,
  label,
  tone = "info",
  href,
  className,
}: {
  value: number;
  label: string;
  tone?: SemanticTone;
  href?: string;
  className?: string;
}) {
  const classes = cn("counter-tile", `status-${tone}`, className);
  const content = (
    <>
      <strong>{new Intl.NumberFormat("ru-RU").format(value)}</strong>
      <span>{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className={classes}>
      {content}
    </Link>
  ) : (
    <div className={classes}>{content}</div>
  );
}
