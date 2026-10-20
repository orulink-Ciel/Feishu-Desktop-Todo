import { useEffect, useRef } from "react";
import { ArrowUpRight, CalendarDays, Check, Layers2, NotebookPen, Route, Sunrise, X } from "lucide-react";
import { themes, type ThemeId } from "./themes";

export function Appearance({
  theme,
  selectTheme,
  saveError,
  onClose,
}: {
  theme: ThemeId;
  selectTheme: (theme: ThemeId) => void;
  saveError: boolean;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.focus();
  }, []);
  return (
    <>
      <button
        className="appearance-dismiss"
        aria-label="收起外观面板"
        onClick={onClose}
        tabIndex={-1}
      />
      <section
        className="appearance-panel"
        ref={panel}
        role="dialog"
        aria-labelledby="appearance-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="appearance-heading">
          <div>
            <h2 id="appearance-title">选择你的风格</h2>
            <p>点击预览，即刻切换。</p>
          </div>
          <button
            className="icon-button"
            aria-label="关闭外观面板"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="theme-grid" role="group" aria-label="界面主题">
          {themes.map((option) => (
            <button
              key={option.id}
              className="theme-option"
              aria-label={`主题：${option.name}`}
              aria-pressed={theme === option.id}
              onClick={() => {
                selectTheme(option.id);
                onClose();
              }}
            >
              <span className="theme-preview" data-theme={option.id} aria-hidden="true">
                <span className="preview-topline"><span className="preview-symbol">{option.mark === "sunrise" ? <Sunrise /> : option.mark === "calendar" ? <CalendarDays /> : <Layers2 />}</span><i>周历</i><span className="preview-dot" /></span>
                <span className="preview-date-strip"><b>12</b><i>13</i><i>14</i><i>15</i><i>16</i></span>
                <span className="preview-task"><span className="preview-check" /><span /><b /></span>
                <span className="preview-task short"><span className="preview-check" /><span /><b /></span>
                <span className="preview-motif">{option.mark === "sunrise" ? <NotebookPen /> : option.mark === "calendar" ? <Route /> : <ArrowUpRight />}</span>
              </span>
              <span className="theme-name">
                {option.name}
                {theme === option.id && <Check size={13} />}
              </span>
              <span className="theme-description">{option.description}</span>
              <span className="theme-mood">{option.mood}</span>
            </button>
          ))}
        </div>
        <p className="appearance-note" role="status">
          {saveError
            ? "当前主题已切换，但无法保存；重启后可能恢复默认。"
            : "主题保存在本机，重新打开后继续使用。"}
        </p>
      </section>
    </>
  );
}
