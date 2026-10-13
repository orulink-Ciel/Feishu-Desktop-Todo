import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface PendingUpdate {
  version: string;
  body?: string;
  download: (onEvent: (event: DownloadEvent) => void) => Promise<void>;
  install: () => Promise<void>;
  close: () => Promise<void>;
}
export interface UpdateApi {
  enabled: boolean;
  version: () => Promise<string>;
  check: () => Promise<PendingUpdate | null>;
  prepare: () => Promise<void>;
  restart: () => Promise<void>;
}
export const updateApi: UpdateApi = {
  enabled: isTauri(),
  version: getVersion,
  check: () => check({ timeout: 20_000 }),
  prepare: () => invoke("prepare_update"),
  restart: relaunch,
};
