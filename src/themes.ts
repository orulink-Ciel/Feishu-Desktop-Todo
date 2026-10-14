import { useLayoutEffect, useState } from "react";

export const themes = [
  {
    id: "mist",
    name: "轻序",
    description: "奶油白 · 陶土红 · 鼠尾草绿",
    mood: "温暖、从容",
    mark: "sunrise",
  },
  {
    id: "ocean",
    name: "日行",
    description: "雾白 · 深青 · 玉绿",
    mood: "清爽、直接",
    mark: "calendar",
  },
  {
    id: "graphite",
    name: "桌序",
    description: "深海军蓝 · 薰衣草紫 · 荧光绿",
    mood: "鲜明、专注",
    mark: "layers",
  },
] as const;
export type ThemeId = (typeof themes)[number]["id"];
const storageKey = "feishu-todo.appearance.v2";

export function readTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(storageKey);
    if (themes.some((theme) => theme.id === saved)) return saved as ThemeId;
  } catch {
    // Appearance remains usable when local storage is unavailable.
  }
  return "mist";
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>(readTheme);
  const [saveError, setSaveError] = useState(false);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const selectTheme = (next: ThemeId) => {
    setTheme(next);
    try {
      localStorage.setItem(storageKey, next);
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  };
  return { theme, selectTheme, saveError };
}
