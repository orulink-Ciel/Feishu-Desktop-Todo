use chrono::{FixedOffset, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    io::Read,
    path::PathBuf,
    process::{Command, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppError {
    pub kind: String,
    pub message: String,
}
impl AppError {
    pub fn new(kind: &str, message: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            message: message.into(),
        }
    }
}
type Result<T> = std::result::Result<T, AppError>;

pub trait Cli: Send + Sync {
    fn call(&self, args: &[&str], timeout: Duration) -> Result<Value>;
}
pub struct NativeCli {
    pub path: Option<PathBuf>,
}
pub const CLI_FILENAME: &str = if cfg!(windows) {
    "lark-cli.exe"
} else {
    "lark-cli"
};
impl NativeCli {
    pub fn discover(resource_dir: Option<PathBuf>) -> Self {
        let mut candidates = vec![];
        if let Some(path) = std::env::var_os("FEISHU_TODO_CLI") {
            candidates.push(PathBuf::from(path));
        }
        if let Some(dir) = resource_dir {
            candidates.push(dir.join("resources").join(CLI_FILENAME));
        }
        if let Some(roaming) = std::env::var_os("APPDATA") {
            candidates.push(
                PathBuf::from(roaming)
                    .join("npm/node_modules/@larksuite/cli/bin")
                    .join(CLI_FILENAME),
            );
        }
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join(CLI_FILENAME),
        );
        if let Some(paths) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&paths) {
                candidates.push(dir.join(CLI_FILENAME));
            }
        }
        Self {
            path: candidates.into_iter().find(|p| p.is_file()),
        }
    }
}
fn read_pipe(mut pipe: impl Read) -> std::io::Result<Vec<u8>> {
    let mut kept = Vec::new();
    let mut buffer = [0; 8192];
    loop {
        let count = pipe.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        if kept.len() + count <= 8 * 1024 * 1024 {
            kept.extend_from_slice(&buffer[..count]);
        }
    }
    Ok(kept)
}
impl Cli for NativeCli {
    fn call(&self, args: &[&str], timeout: Duration) -> Result<Value> {
        let path = self
            .path
            .as_ref()
            .ok_or_else(|| AppError::new("setup", "尚未找到飞书 CLI，请按使用说明安装或配置。"))?;
        let mut command = Command::new(path);
        command
            .args(args)
            .env("LARKSUITE_CLI_NO_UPDATE_NOTIFIER", "1")
            .env("LARKSUITE_CLI_NO_SKILLS_NOTIFIER", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|_| AppError::new("setup", "无法启动飞书 CLI，请检查安装。"))?;
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let out_reader = std::thread::spawn(move || read_pipe(stdout));
        let err_reader = std::thread::spawn(move || read_pipe(stderr));
        let started = Instant::now();
        let (status, timed_out) = loop {
            match child.try_wait() {
                Ok(Some(status)) => break (Some(status), false),
                Ok(None) if started.elapsed() < timeout => {
                    std::thread::sleep(Duration::from_millis(35))
                }
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break (None, true);
                }
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break (None, false);
                }
            }
        };
        let out = out_reader
            .join()
            .ok()
            .and_then(|r| r.ok())
            .unwrap_or_default();
        let err = err_reader
            .join()
            .ok()
            .and_then(|r| r.ok())
            .unwrap_or_default();
        if timed_out {
            return Err(AppError::new(
                "timeout",
                "飞书请求超时，请刷新核对远端状态。",
            ));
        }
        let success = status.map(|s| s.success()).unwrap_or(false);
        let bytes = if success {
            &out
        } else if !err.is_empty() {
            &err
        } else {
            &out
        };
        let text = String::from_utf8_lossy(bytes);
        let parsed = serde_json::from_str::<Value>(&text).or_else(|_| {
            // Authentication commands may prefix their JSON with progress lines.
            let at = text
                .find('{')
                .ok_or_else(|| serde_json::from_str::<Value>("").unwrap_err())?;
            serde_json::from_str(&text[at..])
        });
        let value = match parsed {
            Ok(v) => v,
            Err(_) if success && args.contains(&"--device-code") => return Ok(json!({"ok":true})),
            Err(_) => {
                return Err(AppError::new(
                    "network",
                    "飞书请求未返回有效结果，请重试；若首次使用，请先配置飞书 CLI。",
                ))
            }
        };
        if !success || value.get("ok") == Some(&Value::Bool(false)) {
            let error = &value["error"];
            let subtype = error["subtype"].as_str().unwrap_or("");
            let kind = match (error["type"].as_str().unwrap_or(""), subtype) {
                (_, "missing_scope") => "auth",
                _ if integer(&error["code"]) == Some(91403) => "permission",
                ("authorization", _) | ("authentication", _) => "auth",
                ("configuration", _) => "setup",
                (_, "rate_limited") => "rate_limit",
                _ => "remote",
            };
            // Never forward raw CLI output, device codes, credentials or command lines.
            let message = match kind {
                "auth" => "飞书登录失效或任务权限不足，请重新授权。".to_string(),
                "setup" => "请先运行飞书 CLI 的配置流程，再回到这里连接。".to_string(),
                "rate_limit" => "飞书请求过于频繁，将稍后重试。".to_string(),
                _ => format!(
                    "飞书操作失败（错误码 {}），请刷新后重试。",
                    error["code"].as_i64().unwrap_or(0)
                ),
            };
            return Err(AppError::new(kind, message));
        }
        Ok(value)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub guid: String,
    pub title: String,
    pub status: String,
    pub completed_at: i64,
    pub assignee_ids: Vec<String>,
    pub mode: u8,
    pub due_at: Option<i64>,
    pub all_day: bool,
    pub updated_at: i64,
    pub task_url: String,
    pub source_url: Option<String>,
    pub source_code: i64,
    #[serde(default)]
    pub external_completion: bool,
    pub pinned_date: Option<String>,
}
fn integer(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
}
impl Task {
    pub fn from_remote(v: &Value) -> Result<Self> {
        let guid = v["guid"]
            .as_str()
            .ok_or_else(|| AppError::new("contract", "飞书任务缺少 GUID。"))?;
        uuid::Uuid::parse_str(guid)
            .map_err(|_| AppError::new("contract", "飞书任务 GUID 格式无效。"))?;
        let title = v["summary"]
            .as_str()
            .ok_or_else(|| AppError::new("contract", "飞书任务缺少标题。"))?;
        let completed = integer(&v["completed_at"]).unwrap_or(0);
        let status = v["status"]
            .as_str()
            .unwrap_or(if completed > 0 { "done" } else { "todo" });
        if !["todo", "done"].contains(&status) {
            return Err(AppError::new("contract", "飞书返回了尚不支持的任务状态。"));
        }
        let members = v["members"]
            .as_array()
            .ok_or_else(|| AppError::new("contract", "飞书任务缺少负责人信息。"))?;
        let assignee_ids = members
            .iter()
            .filter(|m| m["role"] == "assignee" && m["type"] == "user")
            .filter_map(|m| m["id"].as_str().map(String::from))
            .collect();
        let task_url = v["url"]
            .as_str()
            .map(String::from)
            .unwrap_or_else(|| format!("https://applink.feishu.cn/client/todo/detail?guid={guid}"));
        Ok(Self {
            guid: guid.into(),
            title: title.into(),
            status: status.into(),
            completed_at: completed,
            assignee_ids,
            mode: integer(&v["mode"]).unwrap_or(2) as u8,
            due_at: integer(&v["due"]["timestamp"]),
            all_day: v["due"]["is_all_day"].as_bool().unwrap_or(false),
            updated_at: integer(&v["updated_at"]).unwrap_or(0),
            task_url,
            source_url: v["origin"]["href"]["url"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(String::from),
            source_code: integer(&v["source"]).unwrap_or(0),
            external_completion: v["custom_complete"]
                .as_object()
                .is_some_and(|configuration| !configuration.is_empty()),
            pinned_date: None,
        })
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Auth {
    pub state: String,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
    pub can_read: bool,
    pub can_write: bool,
    pub message: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub interval_seconds: u64,
    pub always_on_top: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            interval_seconds: 300,
            always_on_top: false,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub auth: Auth,
    pub tasks: Vec<Task>,
    pub last_synced_at: Option<i64>,
    pub preferences: Preferences,
}

pub struct Store {
    conn: Connection,
}
impl Store {
    pub fn open(path: &std::path::Path) -> Result<Self> {
        let conn =
            Connection::open(path).map_err(|_| AppError::new("storage", "无法打开本地缓存。"))?;
        Self::from_connection(conn)
    }
    fn from_connection(conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
          CREATE TABLE IF NOT EXISTS tasks(account TEXT NOT NULL,guid TEXT NOT NULL,payload TEXT NOT NULL,active INTEGER NOT NULL,PRIMARY KEY(account,guid));
          CREATE TABLE IF NOT EXISTS pins(account TEXT NOT NULL,guid TEXT NOT NULL,pinned_date TEXT NOT NULL,PRIMARY KEY(account,guid));
          CREATE TABLE IF NOT EXISTS accounts(account TEXT PRIMARY KEY,last_sync INTEGER,prefs TEXT);
          CREATE TABLE IF NOT EXISTS duty_cache(account TEXT NOT NULL,source TEXT NOT NULL,payload TEXT NOT NULL,last_sync INTEGER NOT NULL,PRIMARY KEY(account,source));
          PRAGMA user_version=1;")
            .map_err(|_| AppError::new("storage", "无法初始化本地缓存。"))?;
        Ok(Self { conn })
    }
    pub fn replace(&mut self, account: &str, tasks: &[Task], now: i64) -> Result<()> {
        let tx = self.conn.transaction().map_err(db_error)?;
        tx.execute("UPDATE tasks SET active=0 WHERE account=?1", [account])
            .map_err(db_error)?;
        for task in tasks {
            let payload = serde_json::to_string(task)
                .map_err(|_| AppError::new("storage", "任务缓存编码失败。"))?;
            tx.execute("INSERT INTO tasks(account,guid,payload,active) VALUES(?1,?2,?3,1) ON CONFLICT(account,guid) DO UPDATE SET payload=excluded.payload,active=1", params![account, task.guid, payload]).map_err(db_error)?;
        }
        tx.execute("INSERT INTO accounts(account,last_sync) VALUES(?1,?2) ON CONFLICT(account) DO UPDATE SET last_sync=excluded.last_sync", params![account,now]).map_err(db_error)?;
        tx.commit().map_err(db_error)
    }
    pub fn upsert_detail(&mut self, account: &str, task: &Task) -> Result<()> {
        let active = task.status == "todo" && task.assignee_ids.iter().any(|a| a == account);
        let payload = serde_json::to_string(task)
            .map_err(|_| AppError::new("storage", "任务缓存编码失败。"))?;
        self.conn.execute("INSERT INTO tasks(account,guid,payload,active) VALUES(?1,?2,?3,?4) ON CONFLICT(account,guid) DO UPDATE SET payload=excluded.payload,active=excluded.active", params![account,task.guid,payload,active]).map_err(db_error)?;
        Ok(())
    }
    pub fn duty_cache(
        &self,
        account: &str,
    ) -> Result<(Option<crate::duty::DutyPayload>, Option<i64>)> {
        let row: Option<(String, i64)> = self
            .conn
            .query_row(
                "SELECT payload,last_sync FROM duty_cache WHERE account=?1 AND source=?2",
                params![account, crate::duty::BASE],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(db_error)?;
        match row {
            Some((payload, at)) => Ok((
                Some(
                    serde_json::from_str(&payload)
                        .map_err(|_| AppError::new("storage", "值日缓存读取失败。"))?,
                ),
                Some(at),
            )),
            None => Ok((None, None)),
        }
    }
    pub fn save_duty(&mut self, account: &str, payload: &crate::duty::DutyPayload) -> Result<()> {
        let text = serde_json::to_string(payload)
            .map_err(|_| AppError::new("storage", "值日缓存编码失败。"))?;
        self.conn.execute("INSERT INTO duty_cache(account,source,payload,last_sync) VALUES(?1,?2,?3,?4) ON CONFLICT(account,source) DO UPDATE SET payload=excluded.payload,last_sync=excluded.last_sync",
            params![account,crate::duty::BASE,text,Utc::now().timestamp_millis()]).map_err(db_error)?;
        Ok(())
    }
    pub fn clear_duty(&mut self, account: &str) -> Result<()> {
        self.conn
            .execute(
                "DELETE FROM duty_cache WHERE account=?1 AND source=?2",
                params![account, crate::duty::BASE],
            )
            .map_err(db_error)?;
        Ok(())
    }
    pub fn tasks(&self, account: &str) -> Result<Vec<Task>> {
        let mut statement = self.conn.prepare("SELECT t.payload,p.pinned_date FROM tasks t LEFT JOIN pins p ON t.account=p.account AND t.guid=p.guid WHERE t.account=?1 AND t.active=1").map_err(db_error)?;
        let rows = statement
            .query_map([account], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })
            .map_err(db_error)?;
        rows.map(|r| {
            let (payload, pin) = r.map_err(db_error)?;
            let mut task: Task = serde_json::from_str(&payload)
                .map_err(|_| AppError::new("storage", "本地缓存无法读取，请刷新。"))?;
            task.pinned_date = pin;
            Ok(task)
        })
        .collect()
    }
    pub fn find(&self, account: &str, guid: &str) -> Result<Task> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT payload FROM tasks WHERE account=?1 AND guid=?2",
                params![account, guid],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?;
        let payload =
            raw.ok_or_else(|| AppError::new("validation", "任务不在当前用户的缓存中，请刷新。"))?;
        serde_json::from_str(&payload)
            .map_err(|_| AppError::new("storage", "任务缓存无效，请刷新。"))
    }
    pub fn pin(&mut self, account: &str, guid: &str, date: Option<&str>) -> Result<()> {
        self.find(account, guid)?;
        if let Some(date) = date {
            self.conn.execute("INSERT INTO pins VALUES(?1,?2,?3) ON CONFLICT(account,guid) DO UPDATE SET pinned_date=excluded.pinned_date", params![account,guid,date]).map_err(db_error)?;
        } else {
            self.conn
                .execute(
                    "DELETE FROM pins WHERE account=?1 AND guid=?2",
                    params![account, guid],
                )
                .map_err(db_error)?;
        }
        Ok(())
    }
    pub fn last_sync(&self, account: &str) -> Result<Option<i64>> {
        self.conn
            .query_row(
                "SELECT last_sync FROM accounts WHERE account=?1",
                [account],
                |r| r.get(0),
            )
            .optional()
            .map(|v| v.flatten())
            .map_err(db_error)
    }
    pub fn preferences(&self, account: &str) -> Result<Preferences> {
        let raw: Option<Option<String>> = self
            .conn
            .query_row(
                "SELECT prefs FROM accounts WHERE account=?1",
                [account],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?;
        let mut preferences: Preferences = raw
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        if ![120, 300, 600].contains(&preferences.interval_seconds) {
            // Migrate earlier 30/60-second preferences while retaining window settings.
            preferences.interval_seconds = 300;
            self.conn
                .execute(
                    "UPDATE accounts SET prefs=?2 WHERE account=?1",
                    params![account, serde_json::to_string(&preferences).unwrap()],
                )
                .map_err(db_error)?;
        }
        Ok(preferences)
    }
    pub fn save_preferences(&mut self, account: &str, preferences: &Preferences) -> Result<()> {
        if ![120, 300, 600].contains(&preferences.interval_seconds) {
            return Err(AppError::new(
                "validation",
                "同步间隔只能选择 2、5 或 10 分钟。",
            ));
        }
        self.conn.execute("INSERT INTO accounts(account,prefs) VALUES(?1,?2) ON CONFLICT(account) DO UPDATE SET prefs=excluded.prefs", params![account,serde_json::to_string(preferences).unwrap()]).map_err(db_error)?;
        Ok(())
    }
}
fn db_error(_: rusqlite::Error) -> AppError {
    AppError::new("storage", "本地缓存操作失败；请刷新核对飞书状态。")
}

struct LoginSession {
    id: String,
    device_code: String,
    url: String,
    started: Instant,
    expires: Duration,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginLink {
    pub session_id: String,
    pub verification_url: String,
    pub expires_in: u64,
}
pub struct Service {
    pub cli: Arc<dyn Cli>,
    pub store: Store,
    pub auth: Auth,
    login: Option<LoginSession>,
}
impl Service {
    pub fn new(cli: Arc<dyn Cli>, store: Store) -> Self {
        Self {
            cli,
            store,
            auth: Auth {
                state: "needs_auth".into(),
                message: "连接飞书以读取你的任务。".into(),
                ..Default::default()
            },
            login: None,
        }
    }
    pub fn identify(&mut self) -> Result<()> {
        let response = self
            .cli
            .call(&["auth", "status", "--json"], Duration::from_secs(20))?;
        if response["appId"]
            .as_str()
            .filter(|id| !id.is_empty())
            .is_none()
        {
            return Err(AppError::new(
                "setup",
                "首次使用需先配置飞书 CLI 应用，再回到这里连接。",
            ));
        }
        let user = &response["identities"]["user"];
        let id = user["openId"]
            .as_str()
            .filter(|id| !id.is_empty())
            .map(String::from);
        let scopes: HashSet<&str> = user["scope"]
            .as_str()
            .unwrap_or("")
            .split_whitespace()
            .collect();
        let available = user["available"].as_bool().unwrap_or(false);
        let can_read = scopes.contains("task:task:read") || scopes.contains("task:task:write");
        let can_write = scopes.contains("task:task:write");
        self.auth = Auth {
            state: if available && id.is_some() && can_read {
                "ready"
            } else {
                "needs_auth"
            }
            .into(),
            user_id: id,
            user_name: user["userName"].as_str().map(String::from),
            can_read: available && can_read,
            can_write: available && can_write,
            message: if !available {
                "请登录并授权飞书任务。"
            } else if !can_read {
                "当前账号尚未授权任务读取，请连接飞书。"
            } else if !can_write {
                "可读取任务；完成任务需要写入授权。"
            } else {
                "已连接飞书"
            }
            .into(),
        };
        Ok(())
    }
    pub fn bootstrap(&mut self) -> Result<Snapshot> {
        if let Err(error) = self.identify() {
            self.auth = Auth {
                state: if error.kind == "setup" {
                    "not_configured"
                } else {
                    "unavailable"
                }
                .into(),
                message: error.message,
                ..Default::default()
            };
        }
        self.snapshot()
    }
    fn account(&self) -> Result<String> {
        self.auth
            .user_id
            .clone()
            .ok_or_else(|| AppError::new("auth", "请先连接飞书。"))
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let (tasks, last_synced_at, preferences) = if let Some(account) = &self.auth.user_id {
            (
                self.store.tasks(account)?,
                self.store.last_sync(account)?,
                self.store.preferences(account)?,
            )
        } else {
            (vec![], None, Preferences::default())
        };
        Ok(Snapshot {
            auth: self.auth.clone(),
            tasks,
            last_synced_at,
            preferences,
        })
    }
    pub fn refresh(&mut self) -> Result<Snapshot> {
        self.identify()?;
        if !self.auth.can_read {
            return Err(AppError::new("auth", self.auth.message.clone()));
        }
        let account = self.account()?;
        let mut tasks = vec![];
        let mut guids = HashSet::new();
        let mut seen_tokens = HashSet::new();
        let mut token = String::new();
        for _ in 0..100 {
            let mut args = vec![
                "task",
                "tasks",
                "list",
                "--as",
                "user",
                "--type",
                "my_tasks",
                "--completed=false",
                "--page-size",
                "100",
                "--format",
                "json",
            ];
            if !token.is_empty() {
                args.extend(["--page-token", token.as_str()]);
            }
            let response = self.cli.call(&args, Duration::from_secs(30))?;
            let data = &response["data"];
            let items = data["items"]
                .as_array()
                .ok_or_else(|| AppError::new("contract", "飞书任务列表格式变化，保留上次缓存。"))?;
            for item in items {
                let task = Task::from_remote(item)?;
                if task.status == "todo"
                    && task.assignee_ids.contains(&account)
                    && guids.insert(task.guid.clone())
                {
                    tasks.push(task);
                }
            }
            let more = data["has_more"]
                .as_bool()
                .ok_or_else(|| AppError::new("contract", "飞书分页状态缺失，保留上次缓存。"))?;
            if !more {
                self.store
                    .replace(&account, &tasks, Utc::now().timestamp_millis())?;
                return self.snapshot();
            }
            token = data["page_token"]
                .as_str()
                .filter(|t| !t.is_empty())
                .ok_or_else(|| AppError::new("contract", "飞书分页标记缺失，保留上次缓存。"))?
                .to_string();
            if !seen_tokens.insert(token.clone()) {
                return Err(AppError::new(
                    "contract",
                    "飞书重复返回分页标记，保留上次缓存。",
                ));
            }
        }
        Err(AppError::new(
            "contract",
            "任务超过首版分页上限，保留上次缓存。",
        ))
    }
    pub fn detail(&self, guid: &str) -> Result<Task> {
        uuid::Uuid::parse_str(guid).map_err(|_| AppError::new("validation", "任务 GUID 无效。"))?;
        let response = self.cli.call(
            &[
                "task",
                "tasks",
                "get",
                "--as",
                "user",
                "--task-guid",
                guid,
                "--format",
                "json",
            ],
            Duration::from_secs(25),
        )?;
        let task = Task::from_remote(&response["data"]["task"])?;
        if task.guid != guid {
            return Err(AppError::new(
                "contract",
                "飞书返回了不同的任务 GUID，未更新缓存。",
            ));
        }
        Ok(task)
    }
    pub fn complete(&mut self, guid: &str, confirm_whole: bool) -> Result<Snapshot> {
        self.identify()?;
        if !self.auth.can_write {
            return Err(AppError::new("auth", "完成任务需要飞书任务写入授权。"));
        }
        let account = self.account()?;
        self.store.find(&account, guid)?;
        let current = self.detail(guid)?;
        if !current.assignee_ids.contains(&account) {
            return Err(AppError::new(
                "permission",
                "你已不是该任务的负责人，请刷新。",
            ));
        }
        if current.status == "done" && current.completed_at > 0 {
            self.store.upsert_detail(&account, &current)?;
            return self.snapshot();
        }
        if current.external_completion {
            return Err(AppError::new(
                "external_task",
                "此任务需要在来源业务页面完成，请打开飞书任务处理。",
            ));
        }
        if current.assignee_ids.len() > 1 {
            if current.mode == 1 {
                return Err(AppError::new(
                    "shared_task",
                    "多人会签任务请在飞书中完成你的份额。",
                ));
            }
            if !confirm_whole {
                return Err(AppError::new(
                    "shared_task",
                    "这是多人任务，需要确认完成整个任务。",
                ));
            }
        }
        let write = self.cli.call(
            &[
                "task",
                "+complete",
                "--as",
                "user",
                "--task-id",
                guid,
                "--format",
                "json",
            ],
            Duration::from_secs(25),
        );
        let readback = self.detail(guid);
        if let Ok(task) = &readback {
            if task.status == "done" && task.completed_at > 0 {
                self.store.upsert_detail(&account, task)?;
                return self.snapshot();
            }
        }
        if let Err(error) = write {
            if !["timeout", "network"].contains(&error.kind.as_str()) {
                return Err(error);
            }
        }
        Err(AppError::new(
            "uncertain",
            "完成结果待确认。任务暂时保留，请刷新核对飞书状态。",
        ))
    }
    pub fn pin(&mut self, guid: &str, pinned: bool) -> Result<Snapshot> {
        let account = self.account()?;
        let date = Utc::now()
            .with_timezone(&FixedOffset::east_opt(8 * 3600).unwrap())
            .format("%Y-%m-%d")
            .to_string();
        self.store
            .pin(&account, guid, if pinned { Some(&date) } else { None })?;
        self.snapshot()
    }
    pub fn preferences(&mut self, preferences: Preferences) -> Result<Snapshot> {
        let account = self.account()?;
        self.store.save_preferences(&account, &preferences)?;
        self.snapshot()
    }
    pub fn duty_snapshot(&mut self, refresh: bool) -> Result<crate::duty::DutySnapshot> {
        self.duty_snapshot_from_source(refresh, crate::duty::configured())
    }
    fn duty_snapshot_from_source(
        &mut self,
        refresh: bool,
        configured: bool,
    ) -> Result<crate::duty::DutySnapshot> {
        if !configured {
            return Ok(crate::duty::DutySnapshot {
                account_id: None,
                payload: None,
                last_synced_at: None,
                error: Some("未配置公司值日来源，请联系管理员。".into()),
                cached: false,
            });
        }
        self.bootstrap()?;
        let Some(account) = self.auth.user_id.clone() else {
            return Ok(crate::duty::DutySnapshot {
                account_id: None,
                payload: None,
                last_synced_at: None,
                error: Some("连接飞书后查看值日安排。".into()),
                cached: false,
            });
        };
        let mut error = None;
        if !self.auth.can_read {
            self.store.clear_duty(&account)?;
            return Ok(crate::duty::DutySnapshot {
                account_id: Some(account),
                payload: None,
                last_synced_at: None,
                error: Some("请连接飞书后查看值日安排。".into()),
                cached: false,
            });
        }
        if refresh {
            match crate::duty::load(self.cli.as_ref()) {
                Ok(payload) => self.store.save_duty(&account, &payload)?,
                Err(e) => {
                    if matches!(e.kind.as_str(), "auth" | "permission") {
                        self.store.clear_duty(&account)?;
                        error = Some("没有值日表读取权限，请重新授权或联系管理员。".into());
                    } else {
                        error = Some(format!("值日同步失败：{}", e.message));
                    }
                }
            }
        }
        let (payload, last_synced_at) = self.store.duty_cache(&account)?;
        Ok(crate::duty::DutySnapshot {
            account_id: Some(account),
            cached: !refresh || error.is_some(),
            payload,
            last_synced_at,
            error,
        })
    }
    pub fn begin_login(&mut self) -> Result<LoginLink> {
        let scopes = if crate::duty::configured() {
            "task:task:read task:task:write base:record:read"
        } else {
            "task:task:read task:task:write"
        };
        let result = self.cli.call(
            &["auth", "login", "--scope", scopes, "--no-wait", "--json"],
            Duration::from_secs(30),
        )?;
        let code = result["device_code"]
            .as_str()
            .ok_or_else(|| AppError::new("contract", "飞书未返回授权信息。"))?;
        let url = result["verification_url"]
            .as_str()
            .ok_or_else(|| AppError::new("contract", "飞书未返回授权链接。"))?;
        validate_url(url)?;
        let parsed = url::Url::parse(url).unwrap();
        if parsed.scheme() != "https" || parsed.host_str() != Some("accounts.feishu.cn") {
            return Err(AppError::new("contract", "授权链接不是预期的飞书地址。"));
        }
        let expires = result["expires_in"].as_u64().unwrap_or(600).min(900);
        let id = uuid::Uuid::new_v4().to_string();
        self.login = Some(LoginSession {
            id: id.clone(),
            device_code: code.into(),
            url: url.into(),
            started: Instant::now(),
            expires: Duration::from_secs(expires),
        });
        Ok(LoginLink {
            session_id: id,
            verification_url: url.into(),
            expires_in: expires,
        })
    }
    pub fn finish_login(&mut self, session_id: &str) -> Result<Snapshot> {
        let session = self
            .login
            .take()
            .ok_or_else(|| AppError::new("auth", "请重新生成授权二维码。"))?;
        if session.id != session_id || session.started.elapsed() > session.expires {
            return Err(AppError::new("auth", "授权二维码已过期，请重新连接。"));
        }
        self.cli.call(
            &[
                "auth",
                "login",
                "--device-code",
                &session.device_code,
                "--json",
            ],
            session.expires.saturating_sub(session.started.elapsed()) + Duration::from_secs(15),
        )?;
        self.refresh()
    }
    pub fn auth_url(&self, session_id: &str) -> Result<String> {
        let session = self
            .login
            .as_ref()
            .ok_or_else(|| AppError::new("auth", "授权链接已失效，请重新连接。"))?;
        if session.id != session_id || session.started.elapsed() > session.expires {
            return Err(AppError::new("auth", "授权链接已失效，请重新连接。"));
        }
        Ok(session.url.clone())
    }
    pub fn task_url(&self, guid: &str, source: bool) -> Result<String> {
        let task = self.store.find(&self.account()?, guid)?;
        let url = if source {
            task.source_url
                .ok_or_else(|| AppError::new("validation", "该任务没有来源链接。"))?
        } else {
            task.task_url
        };
        validate_url(&url)?;
        Ok(url)
    }
}
pub fn validate_url(text: &str) -> Result<()> {
    let parsed =
        url::Url::parse(text).map_err(|_| AppError::new("validation", "任务链接格式无效。"))?;
    if !["http", "https"].contains(&parsed.scheme())
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(AppError::new("validation", "只支持打开有效的网页链接。"));
    }
    Ok(())
}

pub fn client_task_url(guid: &str) -> Result<String> {
    uuid::Uuid::parse_str(guid).map_err(|_| AppError::new("validation", "任务 GUID 无效。"))?;
    // Feishu's documented direct AppLink scheme avoids the browser landing page.
    Ok(format!(
        "feishu://applink/client/todo/detail?guid={guid}&mode=app"
    ))
}

#[cfg(test)]
mod tests;
