import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Files,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/ui/primitives/button";
import { Card } from "@/ui/primitives/card";
import { EmptyState } from "@/ui/primitives/empty-state";
import { StatusBadge } from "@/ui/primitives/status-badge";
import { navigation } from "@/ui/shell/navigation";

const sections = {
  "/today": {
    title: "Сегодня",
    lead: "Учебные дела — в одном спокойном ритме.",
    emptyTitle: "Здесь начнётся ваш учебный день",
    description:
      "Пары, важные изменения и ближайшие дела появятся здесь, когда мы подключим учебные данные. А пока можно осмотреться.",
    action: "Открыть расписание",
    href: "/schedule",
    hint: "Меньше искать. Больше успевать.",
    detail:
      "«Пульс» соберёт расписание, результаты и обращения в деканат в одном месте.",
  },
  "/schedule": {
    title: "Расписание",
    lead: "Ваша неделя, без лишней суеты.",
    emptyTitle: "Расписание ещё не добавлено",
    description:
      "Здесь будут пары на сегодня и на неделю: время, аудитории и преподаватели. Изменения выделим, чтобы вы их заметили.",
    action: "На сегодня",
    href: "/today",
    hint: "Планы могут меняться",
    detail:
      "Переносы и отмены появятся в расписании и уведомлениях. Проверяйте их перед выходом на учёбу.",
  },
  "/grades": {
    title: "Учёба",
    lead: "Понимать свой результат и видеть следующий шаг.",
    emptyTitle: "Учебные результаты появятся здесь",
    description:
      "Когда подключим дисциплины, вы увидите оценки, зачёты и прогресс. Подсказки помогут разобраться, на чём сосредоточиться дальше.",
    action: "Посмотреть расписание",
    href: "/schedule",
    hint: "Ваш собственный темп",
    detail:
      "Здесь будут понятные объяснения результатов и сценарии «Что если?», без сравнений с одногруппниками.",
  },
  "/requests": {
    title: "Заявки",
    lead: "Решать вопросы с деканатом, где вам удобно.",
    emptyTitle: "Здесь будут ваши обращения",
    description:
      "Справки, заявления и вопросы в деканат будут собраны на этом экране. Можно будет отправить заявку и проследить каждый её шаг.",
    action: "Вернуться на сегодня",
    href: "/today",
    hint: "Понятно, что происходит",
    detail:
      "У каждой заявки будет статус с пояснением. Если понадобятся уточнения, вы получите уведомление.",
  },
  "/notifications": {
    title: "Уведомления",
    lead: "Важное для вас — в одном месте.",
    emptyTitle: "Лента уведомлений пока пуста",
    description:
      "Здесь появятся изменения расписания, новости деканата и обновления ваших заявок. Пока учебные данные не подключены.",
    action: "Открыть заявки",
    href: "/requests",
    hint: "Поможем не пропустить важное",
    detail:
      "Уведомления будут вести прямо к нужной паре или заявке, чтобы не приходилось искать подробности.",
  },
  "/profile": {
    title: "Профиль",
    lead: "Всё о вашем обучении — под рукой.",
    emptyTitle: "Профиль готовится к подключению",
    description:
      "Здесь будут ваши учебная программа, факультет, курс и контакты. Данные появятся после подключения входа в личный кабинет.",
    action: "На главный экран",
    href: "/today",
    hint: "Личный кабинет начинается с вас",
    detail:
      "В своём профиле вы сможете проверить учебные сведения и контактную информацию.",
  },
  "/staff/requests": {
    title: "Заявки студентов",
    lead: "Помогать студентам и держать дела в порядке.",
    emptyTitle: "Очередь заявок ещё не подключена",
    description:
      "Здесь появятся обращения студентов ваших факультетов. Статусы и сроки помогут определить следующий шаг по каждой заявке.",
    action: "Посмотреть кабинет студента",
    href: "/today",
    hint: "От обращения до результата",
    detail:
      "В этой области будет рабочая очередь деканата с этапами обработки и историей действий.",
  },
};

const shortcuts = [
  {
    href: "/schedule",
    title: "Планировать неделю",
    description: "Расписание и изменения",
    icon: CalendarDays,
  },
  {
    href: "/grades",
    title: "Видеть свой прогресс",
    description: "Оценки и учебные цели",
    icon: BookOpen,
  },
  {
    href: "/requests",
    title: "Решать вопросы",
    description: "Обращения в деканат",
    icon: Files,
  },
];

export function SectionPage({ path }: { path: keyof typeof sections }) {
  const section = sections[path];
  const item = navigation.find((entry) => entry.href === path);
  if (!item) return null;
  return (
    <div className="section-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {path.startsWith("/staff")
              ? "Рабочее пространство"
              : "Ваше пространство"}
          </p>
          <h1>{section.title}</h1>
          <p className="page-lead">{section.lead}</p>
        </div>
        <StatusBadge>Знакомство с «Пульсом»</StatusBadge>
      </div>
      {path === "/today" && (
        <section className="welcome-card" aria-labelledby="welcome-title">
          <div>
            <p className="eyebrow">
              <Sparkles size={15} aria-hidden="true" /> На связи с вашим днём
            </p>
            <h2 id="welcome-title">
              Больше ясности.
              <br />
              Меньше суеты.
            </h2>
            <p>
              Учёба, планы и деканат.
              <br />
              Всё рядом, когда нужно.
            </p>
          </div>
          <div className="pulse-art" aria-hidden="true">
            <div className="pulse-orbit orbit-one" />
            <div className="pulse-orbit orbit-two" />
            <div className="pulse-orbit orbit-three" />
            <svg viewBox="0 0 200 100" aria-hidden="true">
              <path d="M0 53h48l18-29 24 58 24-64 19 35h67" />
            </svg>
          </div>
        </section>
      )}
      <Card className="section-empty-card">
        <div className="card-eyebrow">
          <span>{path === "/today" ? "Ваш день" : "Обзор раздела"}</span>
          <span className="preview-label">Предпросмотр</span>
        </div>
        <EmptyState
          icon={item.icon}
          title={section.emptyTitle}
          description={section.description}
          action={
            <Button asChild variant="outline">
              <Link href={section.href}>
                {section.action}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          }
        />
      </Card>
      {path === "/today" ? (
        <section aria-labelledby="shortcuts-title" className="shortcuts">
          <h2 id="shortcuts-title">Осмотримся?</h2>
          <div className="shortcut-grid">
            {shortcuts.map(({ href, title, description, icon: Icon }) => (
              <Link href={href} key={href} className="shortcut-card">
                <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
                <ArrowUpRight
                  size={16}
                  className="shortcut-arrow"
                  aria-hidden="true"
                />
                <h3>{title}</h3>
                <p>{description}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <aside className="section-hint">
          <Sparkles size={20} aria-hidden="true" />
          <div>
            <h2>{section.hint}</h2>
            <p>{section.detail}</p>
          </div>
        </aside>
      )}
    </div>
  );
}
