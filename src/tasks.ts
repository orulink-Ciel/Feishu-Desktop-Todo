import type { Task } from "./types";
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function dateKey(timestamp = Date.now()): string {
  const parts = dateFormatter.formatToParts(timestamp);
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type)?.value)
    .join("-");
}
export function dueDate(task: Task): string | null {
  if (task.dueAt === null) return null;
  // Feishu all-day values use the calendar date encoded at UTC midnight.
  return task.allDay
    ? new Date(task.dueAt).toISOString().slice(0, 10)
    : dateKey(task.dueAt);
}
export function partitionTasks(tasks: Task[], today: string) {
  const todayTasks: Task[] = [],
    overdue: Task[] = [],
    future: Task[] = [],
    undated: Task[] = [];
  for (const task of tasks) {
    if (task.status !== "todo") continue;
    const due = dueDate(task);
    if (task.pinnedDate === today || due === today) todayTasks.push(task);
    else if (due && due < today) overdue.push(task);
    else if (due) future.push(task);
    else undated.push(task);
  }
  const sort = (a: Task, b: Task) =>
    Number(b.pinnedDate === today) - Number(a.pinnedDate === today) ||
    (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) ||
    a.guid.localeCompare(b.guid);
  return {
    today: todayTasks.sort(sort),
    overdue: overdue.sort(sort),
    future: future.sort(sort),
    undated: undated.sort(sort),
  };
}
export function dateLabel(task: Task, today: string): string {
  const due = dueDate(task);
  if (!due) return task.pinnedDate === today ? "固定到今天" : "没有截止日期";
  if (due === today)
    return task.allDay
      ? "今天到期"
      : `今天 ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(task.dueAt!)}`;
  return `${due.slice(5).replace("-", "/")} 到期`;
}
export function retryDelay(failures: number, interval: number): number {
  return Math.min(1_800_000, interval * 1000 * 2 ** Math.min(failures, 5));
}
export function errorMessage(error: unknown): {
  kind: string;
  message: string;
} {
  if (typeof error === "object" && error && "message" in error) {
    return {
      kind: "kind" in error ? String(error.kind) : "unknown",
      message: String(error.message),
    };
  }
  return {
    kind: "unknown",
    message: typeof error === "string" ? error : "操作未成功，请刷新重试。",
  };
}
