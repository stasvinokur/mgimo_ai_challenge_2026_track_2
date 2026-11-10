import { Skeleton } from "@/ui/primitives/skeleton";

export default function Loading() {
  return (
    <section
      className="section-page"
      aria-busy="true"
      aria-label="Загрузка талонов"
    >
      <p role="status" className="sr-only">
        Загружаем очередь на получение…
      </p>
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-5 w-full" />
      {[0, 1, 2].map((item) => (
        <Skeleton key={item} className="h-48 rounded-feature" />
      ))}
    </section>
  );
}
