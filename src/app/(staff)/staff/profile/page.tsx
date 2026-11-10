import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { LogoutButton } from "@/app/(auth)/logout-button";
import { identity } from "@/composition/container";
import { PasskeyCard } from "@/ui/identity/passkey-card";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { StatusBadge } from "@/ui/primitives/status-badge";
import { SettingsCard } from "@/ui/settings/settings-card";

export const metadata: Metadata = { title: "Профиль сотрудника" };

export default async function Page() {
  const actor = await requireStaff();
  const profile = await identity.getStaffProfile
    .execute(actor)
    .catch(mapPageError);
  return (
    <div className="section-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Кабинет сотрудника</p>
          <h1>Профиль сотрудника</h1>
        </div>
      </div>
      <Card variant="hero">
        <CardHeader>
          <StatusBadge tone="info">Сотрудник деканата</StatusBadge>
          <p className="mt-2 text-greeting font-bold">{profile.fullName}</p>
          <p className="text-sm text-pulse-muted">
            Помогайте студентам своих факультетов — от первого обращения до
            готового документа.
          </p>
        </CardHeader>
        <CardContent>
          <Button
            asChild
            className="bg-pulse-now text-pulse-now-ink hover:bg-pulse-now/90"
          >
            <Link href="/staff/requests">Открыть очередь заявок</Link>
          </Button>
        </CardContent>
      </Card>
      <Card className="rounded-feature">
        <CardHeader>
          <CardTitle>
            <h2>Данные сотрудника</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-4">
            <div>
              <dt className="text-sm text-muted-foreground">ФИО</dt>
              <dd className="m-0 font-medium">{profile.fullName}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Факультеты</dt>
              <dd className="m-0">
                {profile.faculties.length ? (
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {profile.faculties.map((faculty) => (
                      <li
                        key={faculty}
                        className="flex items-start gap-3 rounded-xl border bg-background p-4"
                      >
                        <Building2
                          className="mt-1 size-5 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        {faculty}
                      </li>
                    ))}
                  </ul>
                ) : (
                  "Факультеты пока не назначены. Обратитесь в деканат."
                )}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <PasskeyCard />
      <p className="text-sm text-muted-foreground">
        Тему можно переключить кнопкой вверху страницы.
      </p>
      <SettingsCard />
      <div className="flex flex-wrap items-start gap-4">
        <LogoutButton language="ru" />
        <Button variant="ghost" asChild>
          <Link href="/staff/requests">К заявкам</Link>
        </Button>
      </div>
    </div>
  );
}
