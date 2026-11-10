import { Skeleton } from "@/ui/primitives/skeleton";

export default function Loading() {
  return (
    <div
      className="section-page"
      role="status"
      aria-label="Загружаем ведомости"
    >
      <Skeleton className="h-9 w-48" />
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-40 w-full" />
        ))}
      </div>
    </div>
  );
}
