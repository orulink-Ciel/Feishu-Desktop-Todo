export interface Task {
  guid: string;
  title: string;
  status: "todo" | "done";
  completedAt: number;
  assigneeIds: string[];
  mode: number;
  dueAt: number | null;
  allDay: boolean;
  updatedAt: number;
  taskUrl: string;
  sourceUrl: string | null;
  sourceCode: number;
  externalCompletion: boolean;
  pinnedDate: string | null;
}
export interface Auth {
  state: string;
  userId: string | null;
  userName: string | null;
  canRead: boolean;
  canWrite: boolean;
  message: string;
}
export interface Preferences {
  intervalSeconds: 120 | 300 | 600;
  alwaysOnTop: boolean;
}
export interface Snapshot {
  auth: Auth;
  tasks: Task[];
  lastSyncedAt: number | null;
  preferences: Preferences;
}
export interface AppError {
  kind: string;
  message: string;
}
export interface LoginLink {
  sessionId: string;
  verificationUrl: string;
  expiresIn: number;
}
export interface Bridge {
  preview: boolean;
  duty(refresh: boolean): Promise<DutySnapshot>;
  openDuty(
    document: boolean,
    table?: "exceptions" | "leave" | "calendar",
  ): Promise<void>;
  snapshot(): Promise<Snapshot>;
  refresh(): Promise<Snapshot>;
  complete(guid: string, confirmWhole: boolean): Promise<Snapshot>;
  pin(guid: string, pinned: boolean): Promise<Snapshot>;
  preferences(preferences: Preferences): Promise<Snapshot>;
  beginLogin(): Promise<LoginLink>;
  finishLogin(sessionId: string): Promise<Snapshot>;
  openTask(guid: string, source: boolean): Promise<void>;
  openAuth(sessionId: string): Promise<void>;
}
export interface DutyPayload {
  roster: Record<string, unknown>[];
  rules: Record<string, unknown>[];
  exceptions: Record<string, unknown>[];
  calendar: Record<string, unknown>[];
  leave: Record<string, unknown>[];
}
export interface DutySnapshot {
  accountId: string | null;
  payload: DutyPayload | null;
  lastSyncedAt: number | null;
  error: string | null;
  cached: boolean;
}
