import {
  Bell,
  BookOpen,
  BookText,
  CalendarDays,
  Files,
  Inbox,
  Sun,
  UserRound,
} from "lucide-react";

export const navigation = [
  {
    href: "/today",
    label: "Сегодня",
    icon: Sun,
    audience: "student",
    placement: "primary",
  },
  {
    href: "/schedule",
    label: "Расписание",
    icon: CalendarDays,
    audience: "student",
    placement: "primary",
  },
  {
    href: "/grades",
    label: "Учёба",
    icon: BookOpen,
    audience: "student",
    placement: "primary",
  },
  {
    href: "/requests",
    label: "Заявки",
    icon: Files,
    audience: "student",
    placement: "primary",
  },
  {
    href: "/profile",
    label: "Профиль",
    icon: UserRound,
    audience: "student",
    placement: "primary",
  },
  {
    href: "/notifications",
    label: "Уведомления",
    icon: Bell,
    audience: "student",
    placement: "header",
  },
  {
    href: "/regulations",
    label: "Положения деканата",
    icon: BookText,
    audience: "student",
    placement: "secondary",
  },
  {
    href: "/staff/requests",
    label: "Заявки студентов",
    icon: Inbox,
    audience: "staff",
    placement: "primary",
  },
  {
    href: "/staff/pickup",
    label: "Очередь сегодня",
    icon: CalendarDays,
    audience: "staff",
    placement: "primary",
  },
  {
    href: "/teacher/grades",
    label: "Ведомость",
    icon: BookOpen,
    audience: "teacher",
    placement: "primary",
  },
  {
    href: "/teacher",
    label: "Мои пары",
    icon: CalendarDays,
    audience: "teacher",
    placement: "primary",
  },
] as const;

export type Audience = "student" | "staff" | "teacher";
export type SectionPath = (typeof navigation)[number]["href"];
