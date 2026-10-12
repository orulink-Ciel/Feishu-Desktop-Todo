import { useLayoutEffect, useState } from "react";

export const themes = [
  { id: "mist", name: "雾蓝", description: "柔和蓝灰 · 浮层卡片" },
  { id: "paper", name: "暖纸", description: "暖白茶褐 · 手账质感" },
  { id: "graphite", name: "墨夜", description: "炭黑银灰 · 安静专注" },
  { id: "ocean", name: "深海", description: "深蓝青绿 · 清晰沉稳" },
  { id: "rose", name: "暮紫", description: "灰紫浅粉 · 轻盈柔和" },
  { id: "minimal", name: "素白", description: "黑白细线 · 极简列表" },
] as const;
export type ThemeId = (typeof themes)[number]["id"];
const storageKey = "feishu-todo.appearance.v1";

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
