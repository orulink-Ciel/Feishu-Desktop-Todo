import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { Task } from "./types";
import { dueDate, shiftDate, weekdayLabel, weekDateKeys } from "./tasks";

type Props = {
  tasks: Task[];
  today: string;
  loading: boolean;
  canRead: boolean;
  loginMessage: string;
  onLogin: () => void;
  renderTask: (task: Task) => ReactNode;
};

const shortDate = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;

export function WeeklyCalendar({
  tasks,
  today,
  loading,
  canRead,
  loginMessage,
  onLogin,
  renderTask,
}: Props) {
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  const days = useMemo(() => weekDateKeys(anchor), [anchor]);
  const first = days[0];
  const last = days[6];
  const datedTasks = tasks.filter(
    (task) => task.status === "todo" && dueDate(task) !== null,
  );
  const overdue = datedTasks
    .filter((task) => dueDate(task)! < today && dueDate(task)! < first)
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  const weekTasks = datedTasks
    .filter((task) => {
      const due = dueDate(task)!;
      return due >= first && due <= last;
    })
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  const countByDate = new Map<string, number>();
  for (const task of weekTasks) {
    const due = dueDate(task)!;
    countByDate.set(due, (countByDate.get(due) ?? 0) + 1);
  }
  const weekLabel = `${shortDate(first)} - ${shortDate(last)}`;

  useEffect(() => {
    if (selected < first || selected > last) setSelected(first);
  }, [first, last, selected]);

  const moveWeek = (amount: number) => {
    const next = shiftDate(first, amount * 7);
    setAnchor(next);
    setSelected(next);
  };
  const selectDay = (date: string) => {
    setSelected(date);
    document
      .getElementById(`week-day-${date}`)
      ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  const group = (date: string, dayTasks: Task[]) => (
    <section
      className={`week-group ${date === today ? "today-group" : ""}`}
      id={`week-day-${date}`}
      key={date}
      aria-labelledby={`week-heading-${date}`}
    >
      <header className="week-group-heading" id={`week-heading-${date}`}>
        <div>
          <strong>{shortDate(date)}</strong>
          <span>{weekdayLabel(date)}</span>
          {date === today && <span className="week-today">今天</span>}
        </div>
        <span className="week-group-count">
          {dayTasks.length > 0 ? `${dayTasks.length} 项` : "暂无任务"}
        </span>
      </header>
      {dayTasks.length > 0 ? (
        <ul>{dayTasks.map(renderTask)}</ul>
      ) : (
        <p className="week-empty-day">这一天没有截止任务</p>
      )}
    </section>
  );

  return (
    <main className="week-page" aria-label="一周任务截止日">
      <div className="week-heading-row">
        <div className="week-heading-copy">
          <CalendarDays size={16} aria-hidden="true" />
          <div>
            <h1>周历</h1>
            <p>{weekLabel}</p>
          </div>
        </div>
        <div className="week-navigation" aria-label="切换周">
          <button
            className="icon-button"
            aria-label="上一周"
            onClick={() => moveWeek(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="下一周"
            onClick={() => moveWeek(1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="week-day-strip" role="group" aria-label="选择日期">
        {days.map((date) => {
          const count = countByDate.get(date) ?? 0;
          return (
            <button
              key={date}
              className={`week-day-button ${selected === date ? "selected" : ""} ${date === today ? "is-today" : ""}`}
              aria-pressed={selected === date}
              aria-label={`${weekdayLabel(date)} ${shortDate(date)}，${count} 项到期`}
              onClick={() => selectDay(date)}
            >
              <span className="week-day-label">{weekdayLabel(date)}</span>
              <strong>{Number(date.slice(8, 10))}</strong>
              <span className="week-day-count">{count || "·"}</span>
            </button>
          );
        })}
      </div>

      {overdue.length > 0 && (
        <button
          className="week-overdue-summary"
          onClick={() =>
            document
              .getElementById("week-overdue")
              ?.scrollIntoView?.({ behavior: "smooth", block: "start" })
          }
        >
          <span>逾期未完成</span>
          <strong>{overdue.length}</strong>
          <span>项</span>
          <ChevronRight size={13} />
        </button>
      )}

      <div className="week-scroll">
        {loading ? (
          <div className="week-state">正在读取飞书任务…</div>
        ) : !canRead ? (
          <div className="week-state week-connect-state">
            <CalendarDays size={24} />
            <strong>连接飞书后查看周历</strong>
            <span>{loginMessage || "授权后可按截止日期查看一周任务。"}</span>
            <button className="primary-button" onClick={onLogin}>
              连接飞书
            </button>
          </div>
        ) : (
          <>
            {overdue.length > 0 && (
              <section
                className="week-group week-overdue-group"
                id="week-overdue"
                aria-labelledby="week-overdue-heading"
              >
                <header
                  className="week-group-heading"
                  id="week-overdue-heading"
                >
                  <div>
                    <strong>此前到期</strong>
                    <span className="week-overdue-label">逾期</span>
                  </div>
                  <span className="week-group-count">{overdue.length} 项</span>
                </header>
                <ul>{overdue.map(renderTask)}</ul>
              </section>
            )}
            {days.map((date) =>
              group(
                date,
                weekTasks.filter((task) => dueDate(task) === date),
              ),
            )}
            {weekTasks.length === 0 && overdue.length === 0 && (
              <div className="week-state">
                这一周还没有设置截止日期的未完成任务。
              </div>
            )}
          </>
        )}
      </div>
      <p className="week-footnote">按飞书任务的截止日期排列</p>
    </main>
  );
}
