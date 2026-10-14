import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import QRCode from "qrcode";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock3,
  ExternalLink,
  ListTodo,
  LoaderCircle,
  Minus,
  Palette,
  Pin,
  RefreshCw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { bridge } from "./bridge";
import { dateKey, dateLabel, dueDate, errorMessage, partitionTasks } from "./tasks";
import type { LoginLink, Task } from "./types";
import { useTaskBoard } from "./useTaskBoard";
import { useTheme } from "./themes";
import { Appearance } from "./Appearance";
import { DutyCard } from "./DutyCard";
import { UpdatePanel } from "./UpdatePanel";
import { WeeklyCalendar } from "./WeeklyCalendar";

export default function App() {
  const board = useTaskBoard(bridge);
  const appearance = useTheme();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const closeAppearance = () => {
    setAppearanceOpen(false);
    document
      .querySelector<HTMLButtonElement>('[aria-label="切换主题"]')
      ?.focus();
  };
  const [tab, setTab] = useState<"today" | "all">("today");
  const [page, setPage] = useState<"tasks" | "week">("tasks");
  const [search, setSearch] = useState("");
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const [updateSettingsHost, setUpdateSettingsHost] =
    useState<HTMLDivElement | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [login, setLogin] = useState<
    (LoginLink & { expiresAt: number }) | null
  >(null);
  const [qr, setQr] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [confirm, setConfirm] = useState<Task | null>(null);
  const [now, setNow] = useState(Date.now());
  const [dutyRefreshKey, setDutyRefreshKey] = useState(0);
  useEffect(() => {
    if (!settingsOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        settingsPanelRef.current?.contains(target) ||
        settingsTriggerRef.current?.contains(target)
      ) return;
      setSettingsOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSettingsOpen(false);
      settingsTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [settingsOpen]);
  const snapshot = board.snapshot;
  const connected = Boolean(
    snapshot?.auth.state === "ready" &&
    snapshot.auth.userId &&
    snapshot.auth.canRead,
  );
  const today = dateKey(now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (snapshot && isTauri())
      void getCurrentWindow()
        .setAlwaysOnTop(snapshot.preferences.alwaysOnTop)
        .catch(() => board.setError("窗口置顶设置失败，请重试。"));
  }, [snapshot?.preferences.alwaysOnTop]);
  const allTasks = snapshot?.tasks ?? [];
  const filtered = allTasks.filter((task) =>
    task.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const groups = partitionTasks(filtered, today);
  const todayCount = partitionTasks(allTasks, today);
  const totalToday = todayCount.today.length + todayCount.overdue.length;
  const handleError = (error: unknown) =>
    board.setError(errorMessage(error).message);
  const open = (task: Task, source = false) =>
    void bridge.openTask(task.guid, source).catch(handleError);
  const beginLogin = async () => {
    setAuthOpen(true);
    setAuthLoading(true);
    setQr(null);
    setLogin(null);
    try {
      const link = await bridge.beginLogin();
      setLogin({ ...link, expiresAt: Date.now() + link.expiresIn * 1000 });
      setQr(
        await QRCode.toDataURL(link.verificationUrl, {
          width: 232,
          margin: 2,
          color: { dark: "#20242b", light: "#ffffff" },
        }),
      );
    } catch (error) {
      handleError(error);
    } finally {
      setAuthLoading(false);
    }
  };
  const finishLogin = async () => {
    if (login && (await board.finishLogin(login.sessionId))) {
      setAuthOpen(false);
      setLogin(null);
      setQr(null);
    }
  };
  const requestComplete = (task: Task) => {
    if (
      task.externalCompletion ||
      (task.mode === 1 && task.assigneeIds.length > 1)
    ) {
      open(task);
      return;
    }
    if (task.assigneeIds.length > 1) setConfirm(task);
    else void board.complete(task.guid);
  };
  const renderTask = (task: Task) => {
    const pending = board.submitting === task.guid;
    const uncertain = board.uncertain.has(task.guid);
    const sharedCounter = task.mode === 1 && task.assigneeIds.length > 1;
    const external = sharedCounter || task.externalCompletion;
    return (
      <li className={`task ${pending ? "pending" : ""}`} key={task.guid}>
        <button
          className="task-check"
          aria-label={`完成：${task.title}`}
          title={
            external
              ? task.externalCompletion
                ? "打开飞书查看业务完成方式"
                : "在飞书完成个人份额"
              : uncertain
                ? "请先刷新核对完成结果"
                : "完成任务"
          }
          disabled={
            board.working ||
            uncertain ||
            (!external && !snapshot?.auth.canWrite)
          }
          onClick={() => requestComplete(task)}
        >
          {pending ? (
            <LoaderCircle className="spin" size={15} />
          ) : external ? (
            <ArrowUpRight size={13} />
          ) : (
            <Check size={13} className="hover-check" />
          )}
        </button>
        <div className="task-content">
          <button
            className="task-title"
            title={task.title}
            onClick={() => open(task)}
          >
            {task.title}
          </button>
          <div className="task-meta">
            <span
              className={
                Boolean(dueDate(task) && dueDate(task)! < today)
                  ? "due overdue"
                  : "due"
              }
            >
              <Clock3 size={11} />
              {dateLabel(task, today)}
            </span>
            {task.assigneeIds.length > 1 && (
              <span>
                {sharedCounter
                  ? "会签 · 飞书处理"
                  : `${task.assigneeIds.length} 位负责人`}
              </span>
            )}
            {task.externalCompletion && <span>来源页面处理</span>}
            {pending && <span className="task-progress">提交中</span>}
            {uncertain && <span className="task-progress">结果待确认</span>}
          </div>
        </div>
        <div className="task-actions">
          {task.sourceUrl && (
            <button
              className="icon-button source-action"
              title="查看来源"
              aria-label={`查看来源：${task.title}`}
              onClick={() => open(task, true)}
            >
              <ExternalLink size={13} />
            </button>
          )}
          <button
            className={`icon-button ${task.pinnedDate === today ? "pinned" : ""}`}
            title={task.pinnedDate === today ? "取消固定到今天" : "固定到今天"}
            aria-label={`固定：${task.title}`}
            disabled={board.working}
            onClick={() => void board.pin(task.guid, task.pinnedDate !== today)}
          >
            <Pin size={13} />
          </button>
        </div>
      </li>
    );
  };
  const section = (label: string, tasks: Task[], className = "") =>
    tasks.length > 0 && (
      <section className={`task-section ${className}`}>
        <div className="section-title">
          <span>{label}</span>
          <span className="section-count">{tasks.length}</span>
        </div>
        <ul>{tasks.map(renderTask)}</ul>
      </section>
    );
  const dateHeading = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);
  const lastSync = snapshot?.lastSyncedAt
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(snapshot.lastSyncedAt)
    : "尚未同步";

  return (
    <div className="widget">
      <header className="window-bar">
        <div
          className="brand"
          data-tauri-drag-region
          onMouseDown={(event) => {
            if (event.button === 0 && isTauri())
              void getCurrentWindow().startDragging().catch(handleError);
          }}
        >
          <span className="brand-mark">
            <img src="/app-icon.png" alt="" draggable={false} />
          </span>
          轻列便签
        </div>
        <div className="window-actions">
          <button
            className={`icon-button ${appearanceOpen ? "pinned" : ""}`}
            aria-label="切换主题"
            title="切换主题"
            aria-expanded={appearanceOpen}
            onClick={() => setAppearanceOpen(!appearanceOpen)}
          >
            <Palette size={14} />
          </button>
          <button
            className={`icon-button ${snapshot?.preferences.alwaysOnTop ? "pinned" : ""}`}
            aria-label="窗口置顶"
            title={
              snapshot?.preferences.alwaysOnTop ? "取消窗口置顶" : "窗口置顶"
            }
            disabled={!snapshot?.auth.userId || board.working}
            onClick={() =>
              snapshot &&
              void board.preferences({
                ...snapshot.preferences,
                alwaysOnTop: !snapshot.preferences.alwaysOnTop,
              })
            }
          >
            <Pin size={13} />
          </button>
          <button
            className="icon-button"
            aria-label="最小化"
            title="最小化"
            onClick={() =>
              isTauri() && void getCurrentWindow().minimize().catch(handleError)
            }
          >
            <Minus size={15} />
          </button>
          <button
            className="icon-button close-button"
            aria-label="退出"
            title="退出待办"
            onClick={() =>
              isTauri() && void getCurrentWindow().close().catch(handleError)
            }
          >
            <X size={15} />
          </button>
        </div>
      </header>
      {bridge.preview && (
        <div className="preview-banner">
          浏览器预览 · 示例数据，操作不会写入飞书
        </div>
      )}
      <nav className="page-nav" aria-label="页面">
        <button
          className={page === "tasks" ? "active" : ""}
          aria-current={page === "tasks" ? "page" : undefined}
          onClick={() => setPage("tasks")}
        >
          任务
        </button>
        <button
          className={page === "week" ? "active" : ""}
          aria-current={page === "week" ? "page" : undefined}
          onClick={() => setPage("week")}
        >
          <CalendarDays size={13} /> 周历
        </button>
      </nav>
      {page === "week" ? (
        <WeeklyCalendar
          tasks={allTasks}
          today={today}
          loading={board.loading}
          canRead={Boolean(snapshot?.auth.canRead)}
          loginMessage={snapshot?.auth.message ?? ""}
          onLogin={() => void beginLogin()}
          renderTask={renderTask}
        />
      ) : (
        <>
      <div className="hero">
        <img className="hero-motif" src="/app-icon.png" alt="" />
        <div className="date-heading">{dateHeading}</div>
        <div className="headline">
          <div>
            <h1>今日待办</h1>
            <p>专注眼前，有序完成。</p>
          </div>
          <div className="hero-count">
            <strong>{String(totalToday).padStart(2, "0")}</strong>
            <span>件待办</span>
          </div>
        </div>
      </div>
      <nav className="toolbar" aria-label="任务视图">
        <div className="tabs">
          <button
            className={tab === "today" ? "active" : ""}
            onClick={() => {
              setTab("today");
              setSearch("");
            }}
          >
            今天 <span>{totalToday}</span>
          </button>
          <button
            className={tab === "all" ? "active" : ""}
            onClick={() => setTab("all")}
          >
            全部 <span>{allTasks.length}</span>
          </button>
        </div>
        <button
          className="icon-button refresh-button"
          title="刷新飞书任务"
          aria-label="刷新"
          disabled={board.working || !snapshot?.auth.canRead}
          onClick={() => {
            void board.refresh();
            setDutyRefreshKey((key) => key + 1);
          }}
        >
          <RefreshCw
            size={15}
            className={board.working && !board.submitting ? "spin" : ""}
          />
        </button>
      </nav>
      {board.error && (
        <div className="error-banner" role="alert">
          <span>{board.error}</span>
          <button onClick={() => void board.refresh()} disabled={board.working}>
            重试
          </button>
        </div>
      )}
      {tab === "all" && (
        <label className="search-box">
          <Search size={14} />
          <input
            aria-label="搜索任务"
            placeholder="找一件待办…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      )}
      <main className="task-scroll">
        <DutyCard
          api={bridge}
          accountId={snapshot?.auth.userId ?? null}
          date={today}
          interval={snapshot?.preferences.intervalSeconds ?? 300}
          refreshKey={dutyRefreshKey}
        />
        {board.loading ? (
          <div className="empty-state">
            <LoaderCircle className="spin" size={26} />
            <h2>正在整理你的待办</h2>
            <p>先读取缓存，再与飞书核对。</p>
          </div>
        ) : !snapshot?.auth.canRead && allTasks.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">
              <ListTodo size={26} />
            </span>
            <h2>把飞书任务带到桌面</h2>
            <p>{snapshot?.auth.message || "连接飞书，查看今天要做的事。"}</p>
            <button
              className="primary-button"
              onClick={() => void beginLogin()}
              disabled={authLoading || board.working}
            >
              连接飞书 <ArrowUpRight size={14} />
            </button>
            {snapshot?.auth.state === "not_configured" && (
              <p className="setup-hint">
                首次使用需先配置飞书 CLI 应用，参见使用说明。
              </p>
            )}
          </div>
        ) : (
          <>
            {section("今日安排", groups.today)}
            {groups.overdue.length > 0 && (
              <section className="task-section overdue-section">
                <button
                  className="section-toggle"
                  aria-expanded={overdueOpen}
                  onClick={() => setOverdueOpen(!overdueOpen)}
                >
                  <div>
                    <span className="overdue-dot" />
                    此前到期
                    <span className="section-count">
                      {groups.overdue.length}
                    </span>
                  </div>
                  {overdueOpen ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
                {overdueOpen ? (
                  <ul>{groups.overdue.map(renderTask)}</ul>
                ) : (
                  <p className="folded-description">
                    展开看看，还有哪些事需要跟进。
                  </p>
                )}
              </section>
            )}
            {tab === "all" && section("接下来", groups.future)}
            {tab === "all" && section("还没定日期", groups.undated)}
            {(tab === "today"
              ? groups.today.length + groups.overdue.length
              : filtered.length) === 0 && (
              <div className="empty-state">
                <span className="empty-icon">
                  <CircleCheck size={28} />
                </span>
                <h2>{search ? "没有找到这件事" : "今天的待办清空了"}</h2>
                <p>
                  {search
                    ? "试试更短的关键词。"
                    : "去全部待办看看，或留一点时间给自己。"}
                </p>
                {tab === "today" && (
                  <button className="text-button" onClick={() => setTab("all")}>
                    查看全部待办 <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>
        </>
      )}
      {board.notice && (
        <div className="toast" role="status">
          <CircleCheck size={15} />
          {board.notice}
        </div>
      )}
      {settingsOpen && (
        <div className="settings-panel" id="settings-panel" ref={settingsPanelRef}>
          <button
            className="appearance-setting"
            onClick={() => {
              setSettingsOpen(false);
              setAppearanceOpen(true);
            }}
          >
            <span>
              <Palette size={14} /> 外观主题
            </span>
            <ChevronRight size={14} />
          </button>
          <div>
            <strong>自动同步</strong>
            <select
              aria-label="自动同步间隔"
              value={snapshot?.preferences.intervalSeconds ?? 300}
              disabled={board.working || !snapshot?.auth.userId}
              onChange={(event) =>
                snapshot &&
                void board.preferences({
                  ...snapshot.preferences,
                  intervalSeconds: Number(event.target.value) as
                    120 | 300 | 600,
                })
              }
            >
              <option value={120}>每 2 分钟</option>
              <option value={300}>每 5 分钟</option>
              <option value={600}>每 10 分钟</option>
            </select>
          </div>
          <p>固定到今天仅影响本机，不改飞书截止日期。</p>
          <button
            className="text-button"
            onClick={() => void beginLogin()}
            disabled={board.working || authLoading}
          >
            重新授权飞书 <ArrowUpRight size={13} />
          </button>
          <div className="update-settings-host" ref={setUpdateSettingsHost} />
        </div>
      )}
      <footer className="footer">
        <button
          className="identity-button"
          title="飞书登录与授权"
          onClick={() => {
            setSettingsOpen(false);
            if (!connected) void beginLogin();
            else setSettingsOpen(true);
          }}
        >
          <span
            className={`status-dot ${connected && !board.error ? "connected" : ""}`}
          />
          {connected ? snapshot?.auth.userName || "已连接飞书" : "未连接飞书"}
        </button>
        <div className="footer-right">
          <span
            title={`每 ${(snapshot?.preferences.intervalSeconds ?? 300) / 60} 分钟自动同步`}
          >
            {board.working
              ? "同步中…"
              : `${lastSync}${snapshot?.lastSyncedAt ? " 更新" : ""}${board.error && snapshot?.lastSyncedAt ? " · 缓存" : ""}`}
          </span>
          <button
            className="icon-button"
            title="设置"
            aria-label="设置"
            aria-expanded={settingsOpen}
            aria-controls="settings-panel"
            ref={settingsTriggerRef}
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            <Settings2 size={14} />
          </button>
        </div>
      </footer>
      <UpdatePanel
        settingsOpen={settingsOpen}
        settingsHost={updateSettingsHost}
        taskBusy={board.working}
      />
      {appearanceOpen && (
        <Appearance {...appearance} onClose={closeAppearance} />
      )}
      {authOpen && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-title"
          >
            <button
              className="modal-close icon-button"
              aria-label="关闭授权窗口"
              disabled={board.working}
              onClick={() => {
                setAuthOpen(false);
                setLogin(null);
              }}
            >
              <X size={16} />
            </button>
            <span className="eyebrow">CONNECT TO FEISHU</span>
            <h2 id="auth-title">连接你的飞书待办</h2>
            <p>
              扫码授权读取和完成任务。
              <br />
              完成后，点击下方按钮继续。
            </p>
            {board.error && <p role="alert">{board.error}</p>}
            {authLoading ? (
              <div className="qr-placeholder">
                <LoaderCircle className="spin" size={26} />
              </div>
            ) : qr ? (
              <img className="qr-image" src={qr} alt="飞书任务授权二维码" />
            ) : (
              <div className="qr-placeholder">
                <ListTodo size={28} />
              </div>
            )}
            {login && (
              <>
                <button
                  className="text-button"
                  onClick={() =>
                    void bridge.openAuth(login.sessionId).catch(handleError)
                  }
                >
                  在浏览器打开授权 <ExternalLink size={13} />
                </button>
                <p className="expiry">
                  {Date.now() > login.expiresAt
                    ? "二维码已过期，请重新生成。"
                    : "二维码限时有效，请使用飞书扫描。"}
                </p>
                <button
                  className="primary-button"
                  disabled={board.working || Date.now() > login.expiresAt}
                  onClick={() => void finishLogin()}
                >
                  {board.working ? (
                    <>
                      <LoaderCircle className="spin" size={15} />
                      正在核验授权…
                    </>
                  ) : (
                    "我已完成授权"
                  )}
                </button>
              </>
            )}
            {!login && !authLoading && (
              <button
                className="primary-button"
                onClick={() => void beginLogin()}
              >
                重新生成二维码
              </button>
            )}
            {login && !board.working && (
              <button
                className="text-button regenerate"
                onClick={() => void beginLogin()}
              >
                重新生成
              </button>
            )}
          </section>
        </div>
      )}
      {confirm && (
        <div className="modal-backdrop">
          <section
            className="modal confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <span className="eyebrow">SHARED TASK</span>
            <h2 id="confirm-title">完成整个任务？</h2>
            <p>
              这条任务有 {confirm.assigneeIds.length} 位负责人。
              <br />
              本次操作会完成整个任务。
            </p>
            <div className="confirm-task">{confirm.title}</div>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                onClick={() => setConfirm(null)}
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  void board.complete(confirm.guid, true);
                  setConfirm(null);
                }}
              >
                确认完成
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
