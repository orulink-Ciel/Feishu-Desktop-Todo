import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw, Users } from "lucide-react";
import type { Bridge, DutySnapshot } from "./types";
import { dayNumber, manualDutyForDate } from "./duty";
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
  const result = manualDutyForDate(current?.payload ?? null, date);
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
            accountId && <p>管理员在飞书表中填写周排班后即可查看。</p>
          )}
          {result.state === "unplanned" && current?.payload && (
            <p>管理员每周在飞书填写排班后，刷新即可查看。</p>
          )}
          {cached && syncTime && (
            <p>上次成功同步：{syncTime} · 按飞书手工安排显示</p>
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
          周排班
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
              .openDuty(false, "schedule")
              .catch((e) => setError(errorMessage(e).message))
          }
        >
          飞书排班表 <ArrowUpRight size={11} />
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
            一周一条记录 · 选择周一日期，填写每日值日人员，并标记休息日；桌面会按日期展开显示。
          </p>
          <div className="duty-links duty-manage-links">
            <button
              onClick={() =>
                void api
                  .openDuty(false, "schedule")
                  .catch((e) => setError(errorMessage(e).message))
              }
            >
              打开排班表 <ArrowUpRight size={11} />
            </button>
          </div>
          <p>
            每周新增一条记录：填写周一起始日期，选择周一至周日值日人员；休息日统一在“休息日”字段勾选。未填写人员的工作日会显示“待填写”。
          </p>
          <table aria-label="值日排班预览">
            <thead>
              <tr>
                <th>日期</th>
                <th>值日安排</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 7 }, (_, i) => {
                const day = new Date((dayNumber(previewStart) + i) * 86400000)
                  .toISOString()
                  .slice(0, 10);
                const planned = manualDutyForDate(current?.payload ?? null, day);
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
                          : planned.state === "needsReplacement"
                            ? planned.note ?? planned.message
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
