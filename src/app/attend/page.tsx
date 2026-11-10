import type { Metadata } from "next";
import Link from "next/link";
import { requireStudent } from "@/app/_lib/get-actor";
import { attendanceMessages } from "@/ui/i18n/dictionaries/attendance";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  await requireStudent();
  return { title: t(await getLanguage(), attendanceMessages, "pageTitle") };
}

export default async function Page() {
  await requireStudent();
  const language = await getLanguage();
  return (
    <div className="section-page">
      <h1>{t(language, attendanceMessages, "pageTitle")}</h1>
      <p>{t(language, attendanceMessages, "freshQr")}</p>
      <Link
        className="inline-flex min-h-11 items-center text-primary underline"
        href="/grades#attendance"
      >
        {t(language, attendanceMessages, "myAttendance")}
      </Link>
    </div>
  );
}
