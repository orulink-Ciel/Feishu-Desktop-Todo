import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DutyCard } from "./DutyCard";
import { previewBridge } from "./bridge";
import type { DutySnapshot } from "./types";
afterEach(cleanup);
it("previews holiday/leave results and opens one administrator adjustment table", async () => {
  const api = previewBridge();
  const snapshot = structuredClone(state);
  snapshot.payload!.leave = [
    {
      person: [{ id: "ou_B", name: "乙" }],
      startDate: "2026-10-12",
      endDate: "2026-10-12",
    },
  ];
  api.duty = vi.fn(async () => snapshot);
  api.openDuty = vi.fn(async () => {});
  render(
    <DutyCard
      api={api}
      accountId="a"
      date="2026-10-12"
      interval={300}
      refreshKey={0}
    />,
  );
  await screen.findByText("需要管理员安排代班");
  fireEvent.click(screen.getByRole("button", { name: "排班与调整" }));
  expect(screen.getByRole("table", { name: "值日排班预览" })).toBeTruthy();
  expect(screen.getAllByText("需要管理员安排代班")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "请假与临时调整" }));
  expect(api.openDuty).toHaveBeenCalledWith(false, "adjustments");
});
const state: DutySnapshot = {
  accountId: "a",
  payload: {
    rules: [
      {
        enabled: true,
        startDate: "2026-10-10",
        singleWeekAnchor: "2026-10-05",
        dailyCount: 1,
      },
    ],
    roster: [
      { person: [{ id: "ou_A", name: "甲" }], order: 1, included: true },
      { person: [{ id: "ou_B", name: "乙" }], order: 2, included: true },
    ],
    exceptions: [],
    leave: [],
    calendar: [{ date: "2026-01-01", kind: "年度已核验" }],
  },
  error: null,
  cached: false,
  lastSyncedAt: 1791597600000,
};
it("recalculates a cached roster at midnight and labels stale data", async () => {
  const api = previewBridge();
  api.duty = vi.fn(async () => ({ ...state, cached: true, error: "offline" }));
  const props = { api, accountId: "a", interval: 300, refreshKey: 0 };
  const { rerender } = render(<DutyCard {...props} date="2026-10-10" />);
  await screen.findByText("甲");
  expect(screen.getByText("缓存")).toBeTruthy();
  rerender(<DutyCard {...props} date="2026-10-11" />);
  await screen.findByText("今日无需值日");
  expect(screen.queryByText("甲")).toBeNull();
  rerender(<DutyCard {...props} date="2026-10-12" />);
  await screen.findByText("乙");
});
it("discards a previous account's in-flight result and visible roster", async () => {
  const api = previewBridge();
  let resolve!: (value: DutySnapshot) => void;
  api.duty = vi.fn(async (refresh) =>
    refresh
      ? new Promise<DutySnapshot>((r) => {
          resolve = r;
        })
      : state,
  );
  const props = { api, interval: 300, refreshKey: 0, date: "2026-10-10" };
  const { rerender } = render(<DutyCard {...props} accountId="a" />);
  await screen.findByText("甲");
  await waitFor(() => expect(resolve).toBeDefined());
  api.duty = vi.fn(async () => ({ ...state, accountId: "b", payload: null }));
  rerender(<DutyCard {...props} accountId="b" />);
  await act(async () => resolve(state));
  await waitFor(() => expect(screen.queryByText("甲")).toBeNull());
  expect(screen.getByText("值日未配置")).toBeTruthy();
});
