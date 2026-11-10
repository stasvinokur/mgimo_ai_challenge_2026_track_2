"use client";

import type { StudentProfile } from "@/application/student/ports";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";

export type RequestProfileDto = Pick<
  StudentProfile,
  "fullName" | "faculty" | "program" | "course" | "group" | "recordBookNo"
>;
export type RequestProfileAction = () => Promise<
  { ok: true; profile: RequestProfileDto } | { ok: false }
>;

export function ProfileFields({ profile }: { profile: RequestProfileDto }) {
  const language = useLanguage();
  const tr = (
    key: keyof typeof requestsMessages,
    params?: Record<string, string | number>,
  ) => t(language, requestsMessages, key, params);
  return (
    <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2">
      {[
        [tr("fullName"), profile.fullName],
        [tr("faculty"), profile.faculty],
        [tr("program"), profile.program],
        [
          tr("courseAndGroup"),
          tr("yearAndGroupValue", {
            year: profile.course,
            group: profile.group,
          }),
        ],
        [tr("recordBookNo"), profile.recordBookNo],
      ].map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="mt-1 font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
