import { describe, expect, it } from "vitest";
import { dateKey, dueDate, partitionTasks, retryDelay } from "./tasks";
import type { Task } from "./types";
const task = (
  guid: string,
  dueAt: number | null,
  props: Partial<Task> = {},
): Task => ({
  guid,
  title: "同名",
  status: "todo",
  completedAt: 0,
  assigneeIds: ["user"],
  mode: 2,
  dueAt,
  allDay: false,
  updatedAt: 0,
  taskUrl: "",
  sourceUrl: null,
  sourceCode: 8,
  externalCompletion: false,
  pinnedDate: null,
  ...props,
});
describe("Asia/Shanghai task grouping", () => {
  it("changes date at Beijing midnight instead of host midnight", () => {
    expect(dateKey(Date.parse("2026-10-09T15:59:59Z"))).toBe("2026-10-09");
    expect(dateKey(Date.parse("2026-10-09T16:00:00Z"))).toBe("2026-10-10");
  });
  it("does not mark a today all-day task overdue", () => {
    const allDay = task("a", Date.parse("2026-10-10T00:00:00Z"), {
      allDay: true,
    });
    expect(dueDate(allDay)).toBe("2026-10-10");
    const groups = partitionTasks([allDay], "2026-10-10");
    expect(groups.today).toHaveLength(1);
    expect(groups.overdue).toHaveLength(0);
  });
  it("includes overdue, pinned future and pinned undated without duplicates", () => {
    const groups = partitionTasks(
      [
        task("today", Date.parse("2026-10-10T18:00:00+08:00")),
        task("old", Date.parse("2026-10-09T18:00:00+08:00")),
        task("pinned-old", Date.parse("2026-10-08T18:00:00+08:00"), {
          pinnedDate: "2026-10-10",
        }),
        task("future", Date.parse("2026-10-12T18:00:00+08:00"), {
          pinnedDate: "2026-10-10",
        }),
        task("undated", null, { pinnedDate: "2026-10-10" }),
        task("not-today", null),
        task("done", null, { status: "done", pinnedDate: "2026-10-10" }),
      ],
      "2026-10-10",
    );
    expect(groups.today.map((t) => t.guid)).toEqual([
      "pinned-old",
      "future",
      "undated",
      "today",
    ]);
    expect(groups.overdue.map((t) => t.guid)).toEqual(["old"]);
    expect(groups.undated.map((t) => t.guid)).toEqual(["not-today"]);
  });
  it("expires yesterday local pins", () => {
    expect(
      partitionTasks(
        [task("a", null, { pinnedDate: "2026-10-09" })],
        "2026-10-10",
      ).today,
    ).toHaveLength(0);
  });
  it("keeps identical titles separate", () => {
    expect(
      partitionTasks(
        [task("a", null), task("b", null)],
        "2026-10-10",
      ).undated.map((t) => t.guid),
    ).toEqual(["a", "b"]);
  });
  it("never shortens the chosen interval and caps backoff at thirty minutes", () => {
    expect(retryDelay(0, 300)).toBe(300_000);
    expect(retryDelay(1, 300)).toBe(600_000);
    expect(retryDelay(0, 600)).toBe(600_000);
    expect(retryDelay(100, 300)).toBe(1_800_000);
  });
});
