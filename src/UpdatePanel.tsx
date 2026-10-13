import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, LoaderCircle, X } from "lucide-react";
import { updateApi, type PendingUpdate, type UpdateApi } from "./updates";

type Phase =
  | "idle"
  | "checking"
  | "available"
  | "current"
  | "downloading"
  | "installing"
  | "installed"
  | "error";
export function UpdatePanel({
  settingsOpen,
  settingsHost,
  taskBusy,
  api = updateApi,
}: {
  settingsOpen: boolean;
  settingsHost?: HTMLElement | null;
  taskBusy: boolean;
  api?: UpdateApi;
}) {
  const [version, setVersion] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [available, setAvailable] = useState<PendingUpdate | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const pending = useRef<PendingUpdate | null>(null);
  const busy = useRef(false);
  const alive = useRef(false);
  const checkUpdates = useCallback(async () => {
    if (!api.enabled || busy.current) return;
    busy.current = true;
    setPhase("checking");
    setError("");
    try {
      const next = await api.check();
      if (!alive.current) {
        await next?.close();
        return;
      }
      const old = pending.current;
      pending.current = next;
      await old?.close().catch(() => {});
      setAvailable(next);
      setDismissed(false);
      setPhase(next ? "available" : "current");
    } catch {
      if (alive.current) {
        setError("检查更新失败，请检查网络后重试。");
        setPhase("error");
      }
    } finally {
      busy.current = false;
    }
  }, [api]);

  useEffect(() => {
    alive.current = true;
    if (!api.enabled)
      return () => {
        alive.current = false;
      };
    void api
      .version()
      .then((v) => {
        if (alive.current) setVersion(v);
      })
      .catch(() => {});
    const startup = setTimeout(() => void checkUpdates(), 10_000);
    const periodic = setInterval(() => void checkUpdates(), 6 * 60 * 60 * 1000);
    return () => {
      alive.current = false;
      clearTimeout(startup);
      clearInterval(periodic);
      if (!busy.current) void pending.current?.close().catch(() => {});
    };
  }, [api, checkUpdates]);

  const install = async () => {
    if (busy.current || taskBusy || !pending.current) return;
    busy.current = true;
    setError("");
    setProgress(null);
    setPhase("downloading");
    let downloaded = 0;
    let total = 0;
    try {
      // Download verifies the signature before the installation is allowed to start.
      await pending.current.download((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setProgress(
            total
              ? Math.min(100, Math.round((downloaded / total) * 100))
              : null,
          );
        }
      });
      await api.prepare();
      setPhase("installing");
      await pending.current.install();
      // Windows exits into the installer; macOS needs an explicit relaunch.
      setPhase("installed");
      try {
        await api.restart();
      } catch {
        setError("更新已安装，请点击重新启动，或退出后重新打开应用。");
      }
    } catch {
      setError(
        "更新失败，当前版本仍可使用。请检查网络并重试；若持续失败，请联系发布者。",
      );
      setPhase("error");
    } finally {
      busy.current = false;
    }
  };
  const installing = phase === "downloading" || phase === "installing";
  const placeSettings = (content: React.ReactNode) =>
    !settingsOpen
      ? null
      : settingsHost === undefined
        ? content
        : settingsHost
          ? createPortal(content, settingsHost)
          : null;
  if (!api.enabled)
    return placeSettings(
      <div className="update-settings">应用更新仅在桌面版可用</div>,
    );
  return (
    <>
      {placeSettings(
        <div className="update-settings">
          <div>
            <span>应用版本 {version && `v${version}`}</span>
            <button
              className="text-button"
              disabled={
                phase === "checking" || installing || phase === "installed"
              }
              onClick={() => void checkUpdates()}
            >
              {phase === "checking" ? "检查中…" : "检查更新"}
            </button>
          </div>
          <p role="status">
            {phase === "current"
              ? "已是最新版本"
              : error ||
                (available
                  ? `有新版本 v${available.version}`
                  : "启动后自动检查，每 6 小时检查一次。")}
          </p>
          {available && (
            <button
              className="text-button"
              disabled={phase === "checking" || installing}
              onClick={() => setDialog(true)}
            >
              查看更新 <Download size={13} />
            </button>
          )}
        </div>,
      )}
      {available && !dismissed && !dialog && (
        <div className="update-banner" role="status">
          <span>新版本 v{available.version}</span>
          <button
            className="text-button"
            disabled={phase === "checking"}
            onClick={() => setDialog(true)}
          >
            查看更新
          </button>
          <button
            className="icon-button"
            aria-label="稍后更新"
            onClick={() => setDismissed(true)}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {dialog && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-title"
          >
            <button
              className="modal-close icon-button"
              aria-label="关闭更新窗口"
              disabled={installing}
              onClick={() => setDialog(false)}
            >
              <X size={16} />
            </button>
            <span className="eyebrow">APP UPDATE</span>
            <h2 id="update-title">
              {phase === "installed"
                ? "更新已安装"
                : `更新到 v${available?.version}`}
            </h2>
            <p>安装时应用会重新启动，登录信息、主题和窗口位置会保留。</p>
            {available?.body && (
              <div className="update-notes">{available.body}</div>
            )}
            {error && <p role="alert">{error}</p>}
            {installing && (
              <p role="status">
                {phase === "downloading"
                  ? `正在下载${progress === null ? "…" : ` ${progress}%`}`
                  : "正在安装…"}
              </p>
            )}
            <button
              className="primary-button"
              disabled={installing || taskBusy || phase === "checking"}
              onClick={() =>
                phase === "installed"
                  ? void api
                      .restart()
                      .catch(() => setError("请退出后重新打开应用。"))
                  : void install()
              }
            >
              {installing && <LoaderCircle className="spin" size={15} />}
              {phase === "installed"
                ? "重新启动"
                : installing
                  ? "更新中…"
                  : "下载安装并重启"}
            </button>
            {taskBusy && <p>任务同步结束后即可安装。</p>}
          </section>
        </div>
      )}
    </>
  );
}
