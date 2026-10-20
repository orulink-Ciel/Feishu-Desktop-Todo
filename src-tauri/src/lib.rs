mod core;
mod duty;
use core::{
    client_task_url, AppError, LoginLink, NativeCli, Preferences, Service, Snapshot, Store,
};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_window_state::AppHandleExt;

fn update_target() -> String {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else {
        std::env::consts::OS
    };
    let channel = if duty::configured() { "-internal" } else { "" };
    format!("{os}{channel}-{}", std::env::consts::ARCH)
}

#[tauri::command]
fn prepare_update(app: tauri::AppHandle) -> Result<(), String> {
    app.save_window_state(
        tauri_plugin_window_state::StateFlags::POSITION
            | tauri_plugin_window_state::StateFlags::SIZE
            | tauri_plugin_window_state::StateFlags::VISIBLE,
    )
    .map_err(|_| "无法保存窗口位置，请重试更新。".to_owned())
}
type Shared = Arc<Mutex<Service>>;
async fn execute<T: Send + 'static>(
    state: tauri::State<'_, Shared>,
    action: impl FnOnce(&mut Service) -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut service = shared
            .lock()
            .map_err(|_| AppError::new("internal", "同步服务需要重新启动。"))?;
        action(&mut service)
    })
    .await
    .map_err(|_| AppError::new("internal", "同步服务发生异常，请重新启动。"))?
}
#[tauri::command]
async fn get_snapshot(state: tauri::State<'_, Shared>) -> Result<Snapshot, AppError> {
    execute(state, |s| s.bootstrap()).await
}
#[tauri::command]
async fn refresh_tasks(state: tauri::State<'_, Shared>) -> Result<Snapshot, AppError> {
    execute(state, |s| s.refresh()).await
}
#[tauri::command]
async fn get_duty(
    state: tauri::State<'_, Shared>,
    refresh: bool,
) -> Result<duty::DutySnapshot, AppError> {
    execute(state, move |s| s.duty_snapshot(refresh)).await
}
#[tauri::command]
async fn open_duty_url(document: bool, table: Option<String>) -> Result<(), AppError> {
    if !duty::configured() {
        return Err(AppError::new("setup", "未配置公司值日来源，请联系管理员。"));
    }
    let url = if document {
        duty::DOC_URL.to_owned()
    } else {
        let id = match table.as_deref() {
            None => None,
            Some("adjustments" | "exceptions" | "leave") => Some(duty::TABLE_ADJUSTMENTS),
            Some("calendar") => Some(duty::TABLE_CALENDAR),
            _ => return Err(AppError::new("open", "值日入口无效。")),
        };
        id.map_or_else(
            || duty::BASE_URL.to_owned(),
            |id| format!("{}?table={id}", duty::BASE_URL),
        )
    };
    open::that(url).map_err(|_| AppError::new("open", "无法打开值日制度，请检查默认浏览器。"))
}
#[tauri::command]
async fn complete_task(
    state: tauri::State<'_, Shared>,
    guid: String,
    confirm_whole: bool,
) -> Result<Snapshot, AppError> {
    execute(state, move |s| s.complete(&guid, confirm_whole)).await
}
#[tauri::command]
async fn set_pin(
    state: tauri::State<'_, Shared>,
    guid: String,
    pinned: bool,
) -> Result<Snapshot, AppError> {
    execute(state, move |s| s.pin(&guid, pinned)).await
}
#[tauri::command]
async fn save_preferences(
    state: tauri::State<'_, Shared>,
    preferences: Preferences,
) -> Result<Snapshot, AppError> {
    execute(state, move |s| s.preferences(preferences)).await
}
#[tauri::command]
async fn auth_begin(state: tauri::State<'_, Shared>) -> Result<LoginLink, AppError> {
    execute(state, |s| s.begin_login()).await
}
#[tauri::command]
async fn auth_finish(
    state: tauri::State<'_, Shared>,
    session_id: String,
) -> Result<Snapshot, AppError> {
    execute(state, move |s| s.finish_login(&session_id)).await
}
#[tauri::command]
async fn open_task_url(
    state: tauri::State<'_, Shared>,
    guid: String,
    source: bool,
) -> Result<(), AppError> {
    execute(state, move |s| {
        let url = s.task_url(&guid, source)?;
        if !source && open::that(client_task_url(&guid)?).is_ok() {
            return Ok(());
        }
        open::that(url)
            .map_err(|_| AppError::new("open", "无法打开任务，请检查飞书安装或默认浏览器。"))
    })
    .await
}
#[tauri::command]
async fn open_auth_url(
    state: tauri::State<'_, Shared>,
    session_id: String,
) -> Result<(), AppError> {
    execute(state, move |s| {
        let url = s.auth_url(&session_id)?;
        open::that(url).map_err(|_| AppError::new("open", "无法打开授权页面，请扫描二维码。"))
    })
    .await
}

fn app_context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

pub fn run() {
    if std::env::args().any(|a| a == "--check-update") {
        check_published_update();
        return;
    }
    if std::env::args().any(|a| a == "--check-runtime") {
        let result = check_bundled_runtime();
        match result {
            Ok(version) => println!(
                "{}",
                serde_json::json!({
                    "ok": true, "platform": std::env::consts::OS,
                    "arch": std::env::consts::ARCH, "cliVersion": version,
                    "dutyConfigured": duty::configured(), "updateTarget": update_target()
                })
            ),
            Err(error) => {
                eprintln!(
                    "{}",
                    serde_json::json!({"ok": false, "error": error.to_string()})
                );
                std::process::exit(1);
            }
        }
        return;
    }
    if std::env::args().any(|a| a == "--diagnose") {
        let result = (|| -> Result<(Snapshot, duty::DutySnapshot), AppError> {
            let cli = Arc::new(NativeCli::discover(None));
            let dir = tempfile_dir()?;
            let mut service = Service::new(cli, Store::open(&dir.join("diagnostic-cache.db"))?);
            service.bootstrap()?;
            let snapshot = service.refresh()?;
            let duty = service.duty_snapshot(true)?;
            Ok((snapshot, duty))
        })();
        // Read-only diagnostic contains no credentials and never writes Feishu tasks.
        match result {
            Ok((snapshot, duty)) => println!(
                "{}",
                serde_json::json!({"ok":true,"userName":snapshot.auth.user_name,"taskCount":snapshot.tasks.len(),"tasks":snapshot.tasks,"lastSyncedAt":snapshot.last_synced_at,"duty":duty})
            ),
            Err(error) => {
                println!("{}", serde_json::json!({"ok":false,"error":error}));
                std::process::exit(1);
            }
        }
        return;
    }
    let context = app_context();
    #[cfg(debug_assertions)]
    let context = {
        let mut context = context;
        if let Ok(port) = std::env::var("FEISHU_TODO_DEBUG_PORT") {
            if let Ok(port) = port.parse::<u16>() {
                context.config_mut().app.windows[0].additional_browser_args =
                    Some(format!("--remote-debugging-port={port}"));
            }
        }
        context
    };
    tauri::Builder::default()
        .plugin(
            tauri_plugin_updater::Builder::new()
                .target(update_target())
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let cli = Arc::new(NativeCli::discover(app.path().resource_dir().ok()));
            let store =
                Store::open(&dir.join("tasks.db")).map_err(|e| std::io::Error::other(e.message))?;
            app.manage(Arc::new(Mutex::new(Service::new(cli, store))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            refresh_tasks,
            complete_task,
            set_pin,
            save_preferences,
            auth_begin,
            auth_finish,
            open_task_url,
            open_auth_url,
            get_duty,
            open_duty_url,
            prepare_update
        ])
        .run(context)
        .expect("Unable to start Feishu desktop widget");
}
fn check_published_update() {
    // Diagnostics download and verify the published package, but never install or open user data.
    let mut context = app_context();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .plugin(
            tauri_plugin_updater::Builder::new()
                .target(update_target())
                .build(),
        )
        .setup(|app| {
            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result = async {
                    let update = app
                        .updater_builder()
                        .timeout(std::time::Duration::from_secs(120))
                        // Inspect the currently advertised package even when it is our own version.
                        .version_comparator(|_, _| true)
                        .build()?
                        .check()
                        .await?
                        .ok_or("The feed did not contain a package")?;
                    let bytes = update.download(|_, _| {}, || {}).await?;
                    Ok::<_, Box<dyn std::error::Error>>(serde_json::json!({
                        "ok": true, "updateTarget": update_target(), "version": update.version,
                        "signatureVerified": true, "downloadBytes": bytes.len(), "installed": false
                    }))
                }
                .await;
                let (value, code) = match result {
                    Ok(value) => (value, 0),
                    Err(error) => (
                        serde_json::json!({ "ok": false, "error": error.to_string() }),
                        1,
                    ),
                };
                println!("{value}");
                app.exit(code);
            });
            Ok(())
        })
        .run(context)
        .expect("Unable to verify published update");
}
fn check_bundled_runtime() -> Result<String, Box<dyn std::error::Error>> {
    // Use only shipped resources: PATH, developer overrides and OAuth are irrelevant to this check.
    let exe = std::env::current_exe()?;
    let dir = exe.parent().ok_or("Missing executable directory")?;
    let resources = if cfg!(target_os = "macos") {
        dir.parent()
            .ok_or("Missing app Contents directory")?
            .join("Resources")
    } else {
        dir.to_path_buf()
    };
    let binary = resources.join("resources").join(core::CLI_FILENAME);
    if !resources.join("resources/LARK-CLI-LICENSE").is_file() {
        return Err("Missing embedded CLI license".into());
    }
    let mut command = std::process::Command::new(binary);
    command.arg("--version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command.output()?;
    if !output.status.success() {
        return Err("Embedded CLI could not start".into());
    }
    Ok(String::from_utf8(output.stdout)?.trim().to_owned())
}
fn tempfile_dir() -> Result<std::path::PathBuf, AppError> {
    let dir = std::env::temp_dir().join("feishu-desktop-todo-diagnostics");
    std::fs::create_dir_all(&dir).map_err(|_| AppError::new("storage", "无法创建诊断缓存。"))?;
    Ok(dir)
}
