import Link from "next/link";
import type { StaffQueueDto } from "@/application/staff/queries";
import { Button } from "@/ui/primitives/button";
import { appPath } from "@/ui/shared/app-path.mjs";

export function StaffFiltersForm({
  filters,
  types,
}: Pick<StaffQueueDto, "filters" | "types">) {
  const input =
    "min-h-11 w-full min-w-0 rounded-xl border bg-background px-3 py-2 text-sm";
  return (
    <form
      action={appPath("/staff/requests")}
      aria-label="Фильтры очереди"
      className="grid min-w-0 gap-3 rounded-feature border bg-card p-3 sm:grid-cols-2 xl:grid-cols-5"
    >
      <label className="space-y-2 text-sm">
        Тип заявки
        <select className={input} name="type" defaultValue={filters.type}>
          <option value="">Все типы</option>
          {types.map((type) => (
            <option key={type.code} value={type.code}>
              {type.title}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-2 text-sm">
        Срок SLA
        <select className={input} name="sla" defaultValue={filters.sla}>
          <option value="all">Любой срок</option>
          <option value="overdue">Просрочено</option>
          <option value="soon">Скоро</option>
          <option value="on_time">В срок</option>
        </select>
      </label>
      <label className="space-y-2 text-sm">
        Ответственный
        <select className={input} name="scope" defaultValue={filters.scope}>
          <option value="all">Все заявки</option>
          <option value="mine">Мои заявки</option>
        </select>
      </label>
      <label className="space-y-2 text-sm">
        Номер заявки
        <input
          type="search"
          className={input}
          name="q"
          defaultValue={filters.q}
          maxLength={20}
          placeholder="З-2026-…"
        />
      </label>
      <div className="flex flex-wrap items-end gap-1 [overflow-wrap:normal]">
        <Button type="submit">Применить</Button>
        <Button variant="ghost" asChild>
          <Link href="/staff/requests">Сбросить</Link>
        </Button>
      </div>
    </form>
  );
}
