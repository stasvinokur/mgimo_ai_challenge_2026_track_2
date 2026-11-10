import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { getRequestProfileAction } from "@/app/(student)/requests/actions";
import ConfirmationPage from "@/app/attend/[code]/page";
import AttendLayout from "@/app/attend/layout";
import AttendPage from "@/app/attend/page";
import type { RequestProfileAction } from "@/ui/requests/profile-fields";
import { anna } from "../fakes/identity";

const mocks = vi.hoisted(() => ({
  profileAction: vi.fn(),
  panel: vi.fn(
    (_props: { requestProfileAction?: RequestProfileAction }) => null,
  ),
  requireStudent: vi.fn(),
  confirmation: vi.fn(async () => ({
    valid: true,
    course: "Учебная дисциплина",
    alreadyPresent: false,
  })),
}));
vi.mock("@/ui/i18n/server", () => ({ getLanguage: async () => "ru" }));
vi.mock("@/app/_lib/get-actor", () => ({
  requireStudent: mocks.requireStudent,
}));
vi.mock("@/app/(student)/requests/actions", () => ({
  getRequestProfileAction: mocks.profileAction,
}));
vi.mock("@/app/(student)/notifications/actions", () => ({
  latestNotificationTitleAction: vi.fn(),
}));
vi.mock("@/app/_lib/map-errors", () => ({
  mapPageError: (error: unknown) => {
    throw error;
  },
}));
vi.mock("@/composition/container", () => ({
  attendance: { getConfirmation: { execute: mocks.confirmation } },
  notifications: {
    getMyPulse: { execute: vi.fn(async () => ({ unread: 0, latestAt: null })) },
  },
  system: { logger: { error: vi.fn() } },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/attend",
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/ui/attendance/confirmation", () => ({
  AttendanceConfirmation: () =>
    createElement("p", null, "Подтверждение отметки"),
}));
vi.mock("@/ui/assistant/chat", () => ({ AssistantChatPanel: mocks.panel }));
vi.mock("@/ui/assistant/use-assistant", () => ({
  useAssistant: () => ({ status: "ready" }),
}));
vi.mock("@/ui/primitives/sheet", () => {
  const passthrough = ({ children }: { children?: ReactNode }) => children;
  return {
    Sheet: passthrough,
    SheetContent: passthrough,
    SheetDescription: passthrough,
    SheetHeader: passthrough,
    SheetTitle: passthrough,
    SheetTrigger: passthrough,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireStudent.mockResolvedValue(anna);
});

it.each(["/attend", "/attend/[code]"])(
  "%s получает одну студенческую оболочку с действием профиля до чата",
  async (path) => {
    const code = "a".repeat(22);
    const children =
      path === "/attend"
        ? await AttendPage()
        : await ConfirmationPage({ params: Promise.resolve({ code }) });
    const shell = await AttendLayout({ children });
    expect(shell.props.audience).toBe("student");
    expect(shell.props.requestProfileAction).toBe(getRequestProfileAction);
    const html = renderToStaticMarkup(shell);
    expect(html.match(/class="app-shell"/g)).toHaveLength(1);
    expect(mocks.panel).toHaveBeenCalledTimes(1);
    expect(mocks.panel.mock.calls[0]?.[0].requestProfileAction).toBe(
      getRequestProfileAction,
    );
    expect(mocks.profileAction).not.toHaveBeenCalled();
    expect(mocks.requireStudent).toHaveBeenCalledTimes(2);
    if (path === "/attend/[code]")
      expect(mocks.confirmation).toHaveBeenCalledWith(anna, { code });
  },
);
