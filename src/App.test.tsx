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
