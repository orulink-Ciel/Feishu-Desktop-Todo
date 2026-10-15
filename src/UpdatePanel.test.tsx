import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UpdatePanel } from "./UpdatePanel";
import type { PendingUpdate, UpdateApi } from "./updates";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function fixture() {
  const update: PendingUpdate = {
    version: "0.1.3",
    body: "改进任务显示。",
    download: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const api: UpdateApi = {
    enabled: true,
    version: vi.fn(async () => "0.1.2"),
    check: vi.fn(async () => update),
    prepare: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
  };
  return { api, update };
}
async function showDialog(api: UpdateApi, taskBusy = false) {
  render(<UpdatePanel settingsOpen taskBusy={taskBusy} api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
  await screen.findByText("有新版本 v0.1.3");
  fireEvent.click(screen.getAllByRole("button", { name: "查看更新" })[0]);
}
it("checks after startup and every six hours without downloading automatically", async () => {
  vi.useFakeTimers();
  const { api, update } = fixture();
  render(<UpdatePanel settingsOpen={false} taskBusy={false} api={api} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9_999);
  });
  expect(api.check).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(api.check).toHaveBeenCalledTimes(1);
  expect(update.download).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6 * 3600_000);
  });
  expect(api.check).toHaveBeenCalledTimes(2);
});
it("rejects overlapping checks and recovers after a network failure", async () => {
  const { api } = fixture();
  let reject!: (error: Error) => void;
  api.check = vi.fn(
    () =>
      new Promise<PendingUpdate | null>((_, r) => {
        reject = r;
      }),
  );
  render(<UpdatePanel settingsOpen taskBusy={false} api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
  fireEvent.click(screen.getByRole("button", { name: "检查中…" }));
  expect(api.check).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("offline")));
  expect(screen.getByText("检查更新失败，请检查网络后重试。")).toBeTruthy();
  api.check = vi.fn(async () => null);
  fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
  await screen.findByText("已是最新版本");
});
it("never installs or restarts when download or signature verification fails", async () => {
  const { api, update } = fixture();
  update.download = vi.fn(async () => {
    throw new Error("invalid signature");
  });
  await showDialog(api);
  fireEvent.click(screen.getByRole("button", { name: "下载安装并重启" }));
  await screen.findByRole("alert");
  expect(update.install).not.toHaveBeenCalled();
  expect(api.prepare).not.toHaveBeenCalled();
  expect(api.restart).not.toHaveBeenCalled();
});
it("waits for task writes and preserves window state before installation", async () => {
  const { api, update } = fixture();
  const calls: string[] = [];
  update.download = vi.fn(async (event) => {
    calls.push("download");
    event({ event: "Started", data: { contentLength: 100 } });
    event({ event: "Progress", data: { chunkLength: 50 } });
  });
  api.prepare = vi.fn(async () => {
    calls.push("save");
  });
  update.install = vi.fn(async () => {
    calls.push("install");
  });
  api.restart = vi.fn(async () => {
    calls.push("restart");
  });
  const view = render(<UpdatePanel settingsOpen taskBusy api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
  await screen.findByText("有新版本 v0.1.3");
  fireEvent.click(screen.getAllByRole("button", { name: "查看更新" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "下载安装并重启" }));
  expect(update.download).not.toHaveBeenCalled();
  view.rerender(<UpdatePanel settingsOpen taskBusy={false} api={api} />);
  fireEvent.click(screen.getByRole("button", { name: "下载安装并重启" }));
  await waitFor(() => expect(api.restart).toHaveBeenCalled());
  expect(calls).toEqual(["download", "save", "install", "restart"]);
});
it("retries only restart after successful installation", async () => {
  const { api, update } = fixture();
  api.restart = vi
    .fn()
    .mockRejectedValueOnce(new Error("restart failed"))
    .mockResolvedValue(undefined);
  await showDialog(api);
  fireEvent.click(screen.getByRole("button", { name: "下载安装并重启" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "重新启动" }));
  await waitFor(() => expect(api.restart).toHaveBeenCalledTimes(2));
  expect(update.install).toHaveBeenCalledTimes(1);
  expect(update.download).toHaveBeenCalledTimes(1);
});
