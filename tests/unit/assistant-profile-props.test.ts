import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import Layout from "@/app/(student)/layout";
import { getRequestProfileAction } from "@/app/(student)/requests/actions";
import type { RequestProfileAction } from "@/ui/requests/profile-fields";
import { anna } from "../fakes/identity";

const mocks = vi.hoisted(() => ({
  profileAction: vi.fn(),
  panel: vi.fn(
    (_props: { requestProfileAction?: RequestProfileAction }) => null,
  ),
  requireStudent: vi.fn(),
}));
vi.mock("@/app/_lib/get-actor", () => ({
  requireStudent: mocks.requireStudent,
}));
vi.mock("@/app/(student)/requests/actions", () => ({
  getRequestProfileAction: mocks.profileAction,
}));
vi.mock("@/app/(student)/notifications/actions", () => ({
  latestNotificationTitleAction: vi.fn(),
}));
vi.mock("@/composition/container", () => ({
  notifications: {
    getMyPulse: { execute: vi.fn(async () => ({ unread: 0, latestAt: null })) },
  },
  system: { logger: { error: vi.fn() } },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
  useRouter: () => ({ refresh: vi.fn() }),
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

it("layout передаёт тот же Server Action через AppShell и AssistantSheet в чат", async () => {
  mocks.requireStudent.mockResolvedValue(anna);
  const element = await Layout({
    children: createElement("p", null, "Кабинет"),
  });
  expect(element.props.requestProfileAction).toBe(getRequestProfileAction);
  renderToStaticMarkup(element);
  expect(mocks.panel).toHaveBeenCalled();
  expect(mocks.panel.mock.calls[0]?.[0].requestProfileAction).toBe(
    getRequestProfileAction,
  );
  expect(mocks.profileAction).not.toHaveBeenCalled();
});
