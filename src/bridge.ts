import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import type { Bridge, Snapshot, Task } from "./types";
import { dateKey } from "./tasks";
const native: Bridge = {
  preview: false,
  autostartEnabled: isAutostartEnabled,
  setAutostart: async (enabled) => {
    if (enabled) await enableAutostart();
    else await disableAutostart();
  },
  duty: (refresh) => invoke("get_duty", { refresh }),
  openDuty: (document, table) =>
    invoke("open_duty_url", { document, table: table ?? null }),
  snapshot: () => invoke("get_snapshot"),
  refresh: () => invoke("refresh_tasks"),
  complete: (guid, confirmWhole) =>
    invoke("complete_task", { guid, confirmWhole }),
  pin: (guid, pinned) => invoke("set_pin", { guid, pinned }),
  preferences: (preferences) => invoke("save_preferences", { preferences }),
  beginLogin: () => invoke("auth_begin"),
  finishLogin: (sessionId) => invoke("auth_finish", { sessionId }),
  openTask: (guid, source) => invoke("open_task_url", { guid, source }),
  openAuth: (sessionId) => invoke("open_auth_url", { sessionId }),
};
export function previewBridge(): Bridge {
  const now = Date.now();
  const today = dateKey(now);
  const midnight = Date.parse(`${today}T00:00:00+08:00`);
  const makeTask = (
    guid: string,
    title: string,
    dueAt: number | null,
    pinnedDate: string | null = null,
  ): Task => ({
    guid,
    title,
    status: "todo",
    completedAt: 0,
    assigneeIds: ["preview"],
    mode: 2,
    dueAt,
    allDay: false,
    updatedAt: now,
    taskUrl: "https://applink.feishu.cn/client/todo/open",
    sourceUrl: null,
    sourceCode: 8,
    externalCompletion: false,
    pinnedDate,
  });
  let state: Snapshot = {
    auth: {
      state: "ready",
      userId: "preview",
      userName: "示例用户",
      canRead: true,
      canWrite: true,
      message: "预览模式",
    },
    tasks: [
      makeTask(
        "00000000-0000-0000-0000-000000000001",
        "完善机器人复刻指南，从 PCB 到整机",
        midnight + 18 * 3600000,
      ),
      makeTask(
        "00000000-0000-0000-0000-000000000002",
        "整理今天的面试问题与沟通记录",
        midnight + 17 * 3600000,
      ),
      makeTask(
        "00000000-0000-0000-0000-000000000003",
        "把活动视频脚本再过一遍",
        null,
        today,
      ),
      makeTask(
        "00000000-0000-0000-0000-000000000004",
        "完成语音助手最佳实践文档",
        midnight - 86400000 + 18 * 3600000,
      ),
      makeTask(
        "00000000-0000-0000-0000-000000000005",
        "下周工作坊的设备与资料准备",
        midnight + 2 * 86400000,
      ),
      makeTask(
        "00000000-0000-0000-0000-000000000006",
        "收集应用测试反馈",
        null,
      ),
    ],
    lastSyncedAt: now,
    preferences: { intervalSeconds: 300, alwaysOnTop: false },
  };
  let autostartEnabled = false;
  const clone = () => structuredClone(state);
  return {
    preview: true,
    autostartEnabled: async () => autostartEnabled,
    setAutostart: async (enabled) => {
      autostartEnabled = enabled;
    },
    duty: async () => ({
      accountId: "preview",
      payload: {
        roster: [],
        rules: [{ enabled: false }],
        exceptions: [],
        calendar: [],
        leave: [],
      },
      lastSyncedAt: Date.now(),
      error: null,
      cached: false,
    }),
    openDuty: async () => {
      throw new Error(
        "浏览器预览使用示例数据；请在配置后的桌面应用中打开公司值日表。",
      );
    },
    snapshot: async () => clone(),
    refresh: async () => {
      state.lastSyncedAt = Date.now();
      return clone();
    },
    complete: async (guid) => {
      await new Promise((r) => setTimeout(r, 650));
      state.tasks = state.tasks.filter((t) => t.guid !== guid);
      return clone();
    },
    pin: async (guid, pinned) => {
      state.tasks = state.tasks.map((t) =>
        t.guid === guid ? { ...t, pinnedDate: pinned ? dateKey() : null } : t,
      );
      return clone();
    },
    preferences: async (preferences) => {
      state.preferences = preferences;
      return clone();
    },
    beginLogin: async () => {
      throw {
        kind: "preview",
        message: "浏览器仅供预览，请在 Windows 应用中连接飞书。",
      };
    },
    finishLogin: async () => clone(),
    openTask: async () => {
      window.open(
        "https://applink.feishu.cn/client/todo/open",
        "_blank",
        "noopener,noreferrer",
      );
    },
    openAuth: async () => {},
  };
}
export const bridge = isTauri() ? native : previewBridge();
