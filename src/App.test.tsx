import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { bridge } from "./bridge";
import type { Auth } from "./types";

const { taskBoard } = vi.hoisted(() => ({ taskBoard: vi.fn() }));
vi.mock("./useTaskBoard", () => ({ useTaskBoard: taskBoard }));
vi.mock("./DutyCard", () => ({ DutyCard: () => null }));
vi.mock("./UpdatePanel", () => ({ UpdatePanel: () => null }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function show(auth: Auth) {
  taskBoard.mockReturnValue({
    snapshot: {
      auth,
      tasks: [],
      lastSyncedAt: null,
      preferences: { intervalSeconds: 300, alwaysOnTop: false },
    },
    working: false,
    loading: false,
    uncertain: new Set(),
    setError: vi.fn(),
  });
  render(<App />);
}
const connected: Auth = {
  state: "ready",
  userId: "ou_current_user",
  userName: "当前用户",
  canRead: true,
  canWrite: true,
  message: "已连接飞书",
};
it("hides a retained name when login is invalid and offers reconnection", async () => {
  const login = vi
    .spyOn(bridge, "beginLogin")
    .mockImplementation(() => new Promise(() => {}));
  show({ ...connected, state: "needs_auth", canRead: false, canWrite: false });
  expect(screen.queryByText("当前用户")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "未连接飞书" }));
  expect(login).toHaveBeenCalledOnce();
});
it("shows the verified connected account", () => {
  show(connected);
  expect(screen.getByRole("button", { name: "当前用户" })).toBeTruthy();
});
it("does not show a stale name when the account identity is missing", () => {
  show({ ...connected, userId: null });
  expect(screen.queryByText("当前用户")).toBeNull();
  expect(screen.getByRole("button", { name: "未连接飞书" })).toBeTruthy();
});
it("keeps the connected name for read-only task authorization", () => {
  show({ ...connected, canWrite: false });
  expect(screen.getByRole("button", { name: "当前用户" })).toBeTruthy();
});
it("closes the appearance panel after selecting a theme", () => {
  show(connected);
  fireEvent.click(screen.getByRole("button", { name: "切换主题" }));
  expect(screen.getByRole("dialog", { name: "选择你的风格" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "主题：桌序" }));
  expect(screen.queryByRole("dialog", { name: "选择你的风格" })).toBeNull();
});
it("closes settings when clicking outside the settings card", () => {
  show(connected);
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  expect(screen.getByText("自动同步")).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByText("自动同步")).toBeNull();
});
it("lets the user toggle autostart from settings", async () => {
  const autostart = vi.spyOn(bridge, "setAutostart").mockResolvedValue();
  show(connected);
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  const toggle = await screen.findByRole("switch", { name: "开机自启动" });
  fireEvent.click(toggle);
  expect(autostart).toHaveBeenCalledWith(true);
});
it("opens the weekly calendar as a separate page", () => {
  show(connected);
  fireEvent.click(screen.getByRole("button", { name: /周历/ }));
  expect(screen.getByRole("main", { name: "一周任务截止日" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "周历" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "今日待办" })).toBeNull();
  expect(screen.getByRole("button", { name: "任务" })).toBeTruthy();
});
