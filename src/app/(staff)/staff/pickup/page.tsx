import type { Metadata } from "next";
import { requireStaff } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { staff } from "@/composition/container";
import { PickupQueue } from "@/ui/staff/pickup-queue";
import { changePickupAction } from "./actions";

export const metadata: Metadata = { title: "Очередь сегодня" };

export default async function Page() {
  const actor = await requireStaff();
  const bookings = await staff.listPickup.execute(actor).catch(mapPageError);
  return (
    <div className="section-page">
      <header className="space-y-2">
        <p className="eyebrow">Получение документов</p>
        <h1>Очередь сегодня</h1>
        <p className="text-sm text-muted-foreground">
          Талоны ваших факультетов по времени записи. Время московское. Выдача
          завершает заявку и уведомляет студента.
        </p>
      </header>
      <PickupQueue bookings={bookings} change={changePickupAction} />
    </div>
  );
}
