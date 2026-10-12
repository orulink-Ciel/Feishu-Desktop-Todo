use super::*;
use std::{collections::VecDeque, sync::Mutex};
const USER: &str = "ou_test_user";
const A: &str = "6fadcf43-c4dc-404b-b924-157bf97922d7";
const B: &str = "9ea3cca1-9df6-48b7-8b8b-25b75480c8e2";
#[test]
fn duty_cache_is_account_scoped_and_cleared_after_permission_denial() {
    let payload = crate::duty::DutyPayload {
        roster: vec![json!({"person":"old user"})],
        rules: vec![],
        exceptions: vec![],
        calendar: vec![],
        leave: vec![],
    };
    let mut s = service(vec![
        Ok(identity(USER)),
        Err(AppError::new("permission", "denied")),
    ]);
    s.store.save_duty(USER, &payload).unwrap();
    assert!(s.store.duty_cache("other").unwrap().0.is_none());
    let result = s.duty_snapshot_from_source(true, true).unwrap();
    assert!(result.error.is_some());
    assert!(result.payload.is_none());
    assert!(s.store.duty_cache(USER).unwrap().0.is_none());
    assert_eq!(s.store.tasks(USER).unwrap().len(), 2);
}
#[test]
fn failed_duty_read_keeps_full_cache_and_does_not_change_tasks() {
    let payload = crate::duty::DutyPayload {
        roster: vec![],
        rules: vec![json!({"enabled":false})],
        exceptions: vec![],
        calendar: vec![],
        leave: vec![],
    };
    let mut s = service(vec![
        Ok(identity(USER)),
        Err(AppError::new("network", "offline")),
    ]);
    s.store.save_duty(USER, &payload).unwrap();
    let result = s.duty_snapshot_from_source(true, true).unwrap();
    assert!(result.cached && result.error.is_some());
    assert_eq!(result.payload.unwrap().rules.len(), 1);
    assert!(result.last_synced_at.is_some());
    assert_eq!(s.store.tasks(USER).unwrap().len(), 2);
}
#[test]
fn unconfigured_duty_source_does_not_call_cli_or_expose_previous_cache() {
    let mut s = service(vec![]);
    s.store
        .save_duty(
            USER,
            &crate::duty::DutyPayload {
                roster: vec![json!({"person":"old company"})],
                rules: vec![],
                exceptions: vec![],
                calendar: vec![],
                leave: vec![],
            },
        )
        .unwrap();
    let snapshot = s.duty_snapshot_from_source(true, false).unwrap();
    assert!(snapshot.payload.is_none());
    assert!(snapshot.account_id.is_none());
    assert!(snapshot.error.unwrap().contains("未配置公司值日来源"));
    assert!(!snapshot.cached);
    assert_eq!(s.store.tasks(USER).unwrap().len(), 2);
}
struct FakeCli {
    queue: Mutex<VecDeque<Result<Value>>>,
}
impl Cli for FakeCli {
    fn call(&self, _: &[&str], _: Duration) -> Result<Value> {
        self.queue
            .lock()
            .unwrap()
            .pop_front()
            .expect("Unexpected extra CLI call")
    }
}
fn fake(values: Vec<Result<Value>>) -> Arc<dyn Cli> {
    Arc::new(FakeCli {
        queue: Mutex::new(values.into()),
    })
}
fn identity(user: &str) -> Value {
    json!({"appId":"cli_test","identities":{"user":{"openId":user,"userName":"测试用户","available":true,"scope":"task:task:read task:task:write"}}})
}
fn remote(guid: &str, status: &str) -> Value {
    json!({"guid":guid,"summary":"同名任务","status":status,"completed_at":if status=="done" { "1791597600000" } else { "0" },"mode":2,"members":[{"type":"user","role":"assignee","id":USER}],"due":{"timestamp":"1791597600000","is_all_day":true},"updated_at":"1791597600000","url":format!("https://applink.feishu.cn/client/todo/detail?guid={guid}")})
}
fn detail(guid: &str, status: &str) -> Value {
    json!({"ok":true,"data":{"task":remote(guid,status)}})
}
fn page(items: Vec<Value>, more: bool, token: &str) -> Value {
    json!({"ok":true,"data":{"items":items,"has_more":more,"page_token":token}})
}
fn service(values: Vec<Result<Value>>) -> Service {
    let store = Store::from_connection(Connection::open_in_memory().unwrap()).unwrap();
    let mut service = Service::new(fake(values), store);
    service.auth = Auth {
        state: "ready".into(),
        user_id: Some(USER.into()),
        can_read: true,
        can_write: true,
        ..Default::default()
    };
    service
        .store
        .replace(
            USER,
            &[
                Task::from_remote(&remote(A, "todo")).unwrap(),
                Task::from_remote(&remote(B, "todo")).unwrap(),
            ],
            100,
        )
        .unwrap();
    service
}
#[test]
fn same_title_completion_only_removes_matching_guid() {
    let mut s = service(vec![
        Ok(identity(USER)),
        Ok(detail(A, "todo")),
        Ok(json!({"ok":true})),
        Ok(detail(A, "done")),
    ]);
    let snapshot = s.complete(A, false).unwrap();
    assert_eq!(snapshot.tasks.len(), 1);
    assert_eq!(snapshot.tasks[0].guid, B);
    assert_eq!(s.store.find(USER, A).unwrap().completed_at, 1791597600000);
}
#[test]
fn external_business_completion_is_not_bypassed() {
    let mut task = remote(A, "todo");
    task["custom_complete"] = json!({"pc":{"href":"https://example.com/complete"}});
    let mut s = service(vec![
        Ok(identity(USER)),
        Ok(json!({"ok":true,"data":{"task":task}})),
    ]);
    assert_eq!(s.complete(A, false).unwrap_err().kind, "external_task");
    assert_eq!(s.store.find(USER, A).unwrap().status, "todo");
}
#[test]
fn unconfigured_cli_has_clear_setup_state_without_old_account_cache() {
    let mut s = service(vec![Ok(json!({"identities":{}}))]);
    let snapshot = s.bootstrap().unwrap();
    assert_eq!(snapshot.auth.state, "not_configured");
    assert!(snapshot.auth.user_id.is_none());
    assert!(snapshot.tasks.is_empty());
}
#[test]
fn successful_write_without_readback_never_marks_local_done() {
    let mut s = service(vec![
        Ok(identity(USER)),
        Ok(detail(A, "todo")),
        Ok(json!({"ok":true})),
        Err(AppError::new("network", "failed")),
    ]);
    assert_eq!(s.complete(A, false).unwrap_err().kind, "uncertain");
    assert_eq!(s.store.find(USER, A).unwrap().status, "todo");
    assert_eq!(s.snapshot().unwrap().tasks.len(), 2);
}
#[test]
fn timed_out_write_with_confirmed_remote_completion_succeeds() {
    let mut s = service(vec![
        Ok(identity(USER)),
        Ok(detail(A, "todo")),
        Err(AppError::new("timeout", "timed out")),
        Ok(detail(A, "done")),
    ]);
    assert_eq!(s.complete(A, false).unwrap().tasks.len(), 1);
}
#[test]
fn explicit_write_failure_keeps_local_pending() {
    let mut s = service(vec![
        Ok(identity(USER)),
        Ok(detail(A, "todo")),
        Err(AppError::new("permission", "denied")),
        Ok(detail(A, "todo")),
    ]);
    assert_eq!(s.complete(A, false).unwrap_err().kind, "permission");
    assert_eq!(s.snapshot().unwrap().tasks.len(), 2);
}
#[test]
fn partial_pagination_failure_does_not_replace_full_cache() {
    let mut s = service(vec![
        Ok(identity(USER)),
        Ok(page(vec![remote(B, "todo")], true, "next")),
        Err(AppError::new("network", "offline")),
    ]);
    assert!(s.refresh().is_err());
    assert_eq!(s.store.tasks(USER).unwrap().len(), 2);
    assert_eq!(s.store.last_sync(USER).unwrap(), Some(100));
}
#[test]
fn full_refresh_reconciles_disappearance_without_inventing_completion() {
    let mut s = service(vec![
        Ok(identity(USER)),
        Ok(page(vec![remote(B, "todo")], false, "")),
    ]);
    assert_eq!(s.refresh().unwrap().tasks.len(), 1);
    assert_eq!(s.store.find(USER, A).unwrap().status, "todo");
}
#[test]
fn changed_account_cannot_complete_previous_users_cached_guid() {
    let mut s = service(vec![Ok(identity("ou_other"))]);
    assert!(s.complete(A, false).is_err());
    assert!(s.snapshot().unwrap().tasks.is_empty());
    assert_eq!(s.store.tasks(USER).unwrap().len(), 2);
}
#[test]
fn shared_tasks_require_whole_task_confirmation_and_countersign_is_blocked() {
    for mode in [1, 2] {
        let mut r = remote(A, "todo");
        r["members"]
            .as_array_mut()
            .unwrap()
            .push(json!({"type":"user","role":"assignee","id":"ou_second"}));
        r["mode"] = json!(mode);
        let mut s = service(vec![
            Ok(identity(USER)),
            Ok(json!({"ok":true,"data":{"task":r}})),
        ]);
        assert_eq!(s.complete(A, mode == 1).unwrap_err().kind, "shared_task");
    }
}
#[test]
fn cache_and_pins_survive_restart_and_are_isolated_by_account() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tasks.db");
    {
        let mut store = Store::open(&path).unwrap();
        store
            .replace(USER, &[Task::from_remote(&remote(A, "todo")).unwrap()], 123)
            .unwrap();
        store.pin(USER, A, Some("2026-10-10")).unwrap();
        store
            .save_preferences(
                USER,
                &Preferences {
                    interval_seconds: 120,
                    always_on_top: true,
                },
            )
            .unwrap();
    }
    let mut store = Store::open(&path).unwrap();
    assert_eq!(
        store.tasks(USER).unwrap()[0].pinned_date.as_deref(),
        Some("2026-10-10")
    );
    assert_eq!(store.last_sync(USER).unwrap(), Some(123));
    assert_eq!(store.preferences(USER).unwrap().interval_seconds, 120);
    assert!(store.tasks("ou_other").unwrap().is_empty());
    store
        .replace(USER, &[Task::from_remote(&remote(A, "todo")).unwrap()], 124)
        .unwrap();
    assert_eq!(
        store.tasks(USER).unwrap()[0].pinned_date.as_deref(),
        Some("2026-10-10")
    );
}
#[test]
fn unsupported_urls_are_rejected() {
    for url in [
        "file:///C:/secret",
        "javascript:alert(1)",
        "https://user:password@example.com",
    ] {
        assert!(validate_url(url).is_err());
    }
    assert!(validate_url(
        "https://applink.feishu.cn/client/todo/detail?guid=abc&suite_entity_num=t1"
    )
    .is_ok());
}
#[test]
fn legacy_sync_intervals_are_migrated_and_saved_without_changing_window_settings() {
    for old in [30, 60] {
        let store = Store::from_connection(Connection::open_in_memory().unwrap()).unwrap();
        let raw = serde_json::to_string(&Preferences {
            interval_seconds: old,
            always_on_top: true,
        })
        .unwrap();
        store
            .conn
            .execute(
                "INSERT INTO accounts(account,prefs) VALUES(?1,?2)",
                params![USER, raw],
            )
            .unwrap();
        let preferences = store.preferences(USER).unwrap();
        assert_eq!(preferences.interval_seconds, 300);
        assert!(preferences.always_on_top);
        let saved: String = store
            .conn
            .query_row("SELECT prefs FROM accounts WHERE account=?1", [USER], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Preferences>(&saved)
                .unwrap()
                .interval_seconds,
            300
        );
    }
}
#[test]
fn client_task_links_use_the_exact_guid_and_reject_parameter_injection() {
    assert_eq!(
        client_task_url(A).unwrap(),
        format!("feishu://applink/client/todo/detail?guid={A}&mode=app")
    );
    for invalid in ["abc", "javascript:alert(1)", "abc&guid=other", "../other"] {
        assert!(client_task_url(invalid).is_err());
    }
    // The generic web opener must not accept arbitrary custom protocols from remote data.
    assert!(validate_url("feishu://applink/client/todo/detail?guid=abc").is_err());
}
#[test]
#[ignore = "Live Feishu read; requires an authorized local CLI"]
fn live_read() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Service::new(
        Arc::new(NativeCli::discover(None)),
        Store::open(&dir.path().join("tasks.db")).unwrap(),
    );
    let snapshot = s.refresh().unwrap();
    assert!(snapshot.auth.can_read);
    assert!(snapshot.auth.user_id.is_some());
    assert!(snapshot.tasks.iter().all(|t| t.status == "todo"
        && t.assignee_ids
            .contains(snapshot.auth.user_id.as_ref().unwrap())));
    println!(
        "Live read: {} tasks, {} document tasks",
        snapshot.tasks.len(),
        snapshot.tasks.iter().filter(|t| t.source_code == 8).count()
    );
}
#[test]
#[ignore = "Live write restricted to the independently created verification task A"]
fn live_roundtrip() {
    assert_eq!(
        std::env::var("FEISHU_TEST_TASK_GUID").expect("Explicit verification GUID required"),
        A
    );
    let dir = tempfile::tempdir().unwrap();
    let mut s = Service::new(
        Arc::new(NativeCli::discover(None)),
        Store::open(&dir.path().join("tasks.db")).unwrap(),
    );
    s.identify().unwrap();
    let account = s.account().unwrap();
    let initial = s.detail(A).unwrap();
    assert!(initial.title.starts_with("【同步验证】"));
    assert_eq!(initial.assignee_ids, vec![account.clone()]);
    s.cli
        .call(
            &[
                "task",
                "+reopen",
                "--as",
                "user",
                "--task-id",
                A,
                "--format",
                "json",
            ],
            Duration::from_secs(25),
        )
        .unwrap();
    s.refresh().unwrap();
    assert_eq!(s.store.find(&account, A).unwrap().status, "todo");
    let snapshot = s.complete(A, false).unwrap();
    assert!(!snapshot.tasks.iter().any(|t| t.guid == A));
    assert_eq!(s.detail(A).unwrap().status, "done");
    println!("Rust adapter live complete/readback passed; dedicated verification task left done");
}
