import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw, Users } from "lucide-react";
import type { Bridge, DutySnapshot } from "./types";
import { dayNumber, dutyForDate } from "./duty";
import { errorMessage, retryDelay } from "./tasks";

export function DutyCard({
  api,
  accountId,
  date,
  interval,
  refreshKey,
}: {
  api: Bridge;
  accountId: string | null;
  date: string;
  interval: number;
  refreshKey: number;
}) {
  const [snapshot, setSnapshot] = useState<DutySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewStart, setPreviewStart] = useState(date);
  useEffect(() => {
    setPreviewStart(date);
  }, [date]);
  useEffect(() => {
    setPreviewOpen(false);
  }, [accountId]);
  const busy = useRef(false);
  const lastAttempt = useRef(0);
  const failures = useRef(0);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!accountId || busy.current) return;
    const current = generation.current;
    busy.current = true;
    lastAttempt.current = Date.now();
    setLoading(true);
    try {
      const next = await api.duty(true);
      if (generation.current !== current) return;
      setSnapshot(next.accountId === accountId ? next : null);
      setError(
        next.accountId === accountId
          ? next.error
          : "飞书身份已变化，请刷新任务。",
      );
      failures.current = next.error ? failures.current + 1 : 0;
    } catch (failure) {
      if (generation.current === current) {
        failures.current++;
        setError(errorMessage(failure).message);
      }
    } finally {
      if (generation.current === current) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [api, accountId]);
  useEffect(() => {
    generation.current++;
    const current = generation.current;
    busy.current = false;
    failures.current = 0;
    lastAttempt.current = Date.now();
    setSnapshot(null);
    setError(null);
    if (accountId)
      void (async () => {
        try {
          const cached = await api.duty(false);
          if (generation.current === current && cached.accountId === accountId)
            setSnapshot(cached);
        } catch {
          /* Remote refresh can recover from a cache read failure. */
        }
        if (generation.current === current) void refresh();
      })();
    return () => {
      generation.current++;
    };
  }, [api, accountId, refresh]);
  const priorRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey !== priorRefreshKey.current) {
      priorRefreshKey.current = refreshKey;
      void refresh();
    }
  }, [refreshKey, refresh]);
  useEffect(() => {
    if (!accountId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const remaining = () =>
      retryDelay(failures.current, interval) -
      (Date.now() - lastAttempt.current);
    const schedule = () => {
      timer = setTimeout(
        async () => {
          if (stopped) return;
          if (remaining() <= 0) await refresh();
          if (!stopped) schedule();
        },
        Math.max(500, remaining()),
      );
    };
    const focus = () => {
      if (remaining() <= 0) void refresh();
    };
    const visible = () => {
      if (document.visibilityState === "visible") focus();
    };
    schedule();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [accountId, interval, refresh]);
  const current = snapshot?.accountId === accountId ? snapshot : null;
  const result = dutyForDate(current?.payload ?? null, date);
  const cached = !!current?.payload && (current.cached || !!error);
  const title = !accountId
    ? "连接飞书后查看值日"
    : !current?.payload && error
      ? "值日暂不可用"
      : !current?.payload && loading
        ? "正在读取值日安排"
        : result.message;
  const syncTime = current?.lastSyncedAt
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(current.lastSyncedAt)
    : null;
  return (
    <section className="duty-card" aria-label="今日值日">
      <div className="duty-main">
        <Users size={15} />
        <div className="duty-content">
          <div className="duty-heading">
            {result.state === "ready" && current?.payload ? "今日值日" : title}
            {cached && <span className="duty-cache">缓存</span>}
          </div>
          {current?.payload && result.state === "ready" && (
            <div className="duty-people">
              {result.people.map((p) => p.name).join("、")}
              {result.people.some((p) => p.id === accountId) && (
                <span className="duty-self">今天有你</span>
              )}
            </div>
          )}
          {current?.payload && result.note && <p>{result.note}</p>}
          {error ? (
            <p className="duty-error" role="status">
              {error}
            </p>
          ) : (
            result.state === "unconfigured" &&
            accountId && <p>管理员填好名单和规则后启用。</p>
          )}
          {cached && syncTime && (
            <p>上次成功同步：{syncTime} · 按今日规则计算</p>
          )}
        </div>
        <button
          className="icon-button"
          aria-label="刷新值日"
          title="刷新值日"
          disabled={loading || !accountId}
          onClick={() => void refresh()}
        >
          <RefreshCw size={13} className={loading ? "spin" : ""} />
        </button>
      </div>
      <div className="duty-links">
        <button
          aria-expanded={previewOpen}
          aria-controls="duty-preview"
          onClick={() => setPreviewOpen(!previewOpen)}
        >
          排班与调整
        </button>
        <button
          onClick={() =>
            void api
              .openDuty(true)
              .catch((e) => setError(errorMessage(e).message))
          }
        >
          值日制度 <ArrowUpRight size={11} />
        </button>
        <button
          onClick={() =>
            void api
              .openDuty(false)
              .catch((e) => setError(errorMessage(e).message))
          }
        >
          名单与规则 <ArrowUpRight size={11} />
        </button>
      </div>
      {previewOpen && (
        <div id="duty-preview" className="duty-preview">
          <label>
            预览起始日期
            <input
              type="date"
              value={previewStart}
              onChange={(e) => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value))
                  setPreviewStart(e.target.value);
              }}
            />
          </label>
          <p>
            未来 14 天 ·
            管理员在飞书修改，桌面刷新后更新。缓存预览以本次读取的配置为准。
          </p>
          <div className="duty-links duty-manage-links">
            <button
              onClick={() =>
                void api
                  .openDuty(false, "exceptions")
                  .catch((e) => setError(errorMessage(e).message))
              }
            >
              调班与休息 <ArrowUpRight size={11} />
            </button>
            <button
              onClick={() =>
                void api
                  .openDuty(false, "leave")
                  .catch((e) => setError(errorMessage(e).message))
              }
            >
              登记请假 <ArrowUpRight size={11} />
            </button>
            <button
              onClick={() =>
                void api
                  .openDuty(false, "calendar")
                  .catch((e) => setError(errorMessage(e).message))
              }
            >
              节假日日历 <ArrowUpRight size={11} />
            </button>
          </div>
          <p>
            代班：填日期、类型“换人”和替班人员。互换：只需一条记录，填两个日期、类型“互换”，不填替班人员。请假起止日期均包含当天。
          </p>
          <table aria-label="值日排班预览">
            <thead>
              <tr>
                <th>日期</th>
                <th>值日安排</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 14 }, (_, i) => {
                const day = new Date((dayNumber(previewStart) + i) * 86400000)
                  .toISOString()
                  .slice(0, 10);
                const planned = dutyForDate(current?.payload ?? null, day);
                return (
                  <tr key={day}>
                    <td>
                      {day.slice(5)}{" "}
                      {new Intl.DateTimeFormat("zh-CN", {
                        weekday: "short",
                        timeZone: "UTC",
                      }).format(new Date(day + "T00:00:00Z"))}
                    </td>
                    <td
                      className={
                        planned.state === "needsReplacement" ||
                        planned.state === "invalid"
                          ? "duty-error"
                          : ""
                      }
                    >
                      {planned.state === "ready"
                        ? planned.people.map((p) => p.name).join("、")
                        : planned.state === "rest"
                          ? "休息"
                          : planned.message}
                      {planned.note && <small>{planned.note}</small>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
