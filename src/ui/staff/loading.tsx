import { Skeleton } from "@/ui/primitives/skeleton";

export function StaffQueueLoading() {
  return (
    <section
      className="flex min-w-0 flex-col gap-4"
      aria-busy="true"
      aria-label="Загрузка очереди заявок"
    >
      <p role="status" className="sr-only">
        Загружаем очередь заявок…
      </p>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-48 w-full rounded-feature sm:h-24" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <Skeleton key={tile} className="h-24 rounded-feature" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((column) => (
          <div key={column} className="space-y-2">
            <Skeleton className="h-11 w-3/4" />
            <Skeleton className="h-48 rounded-feature" />
            <Skeleton className="h-48 rounded-feature" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function StaffProfileLoading() {
  return (
    <section
      className="section-page"
      aria-busy="true"
      aria-label="Загрузка профиля сотрудника"
    >
      <p role="status" className="sr-only">
        Загружаем профиль сотрудника…
      </p>
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-56 rounded-hero" />
      <Skeleton className="h-48 rounded-feature" />
    </section>
  );
}
