use crate::core::{AppError, Cli};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::time::Duration;

include!(concat!(env!("OUT_DIR"), "/duty_config.rs"));

pub fn configured() -> bool {
    !BASE.is_empty() && BASE != "YOUR_BASE_TOKEN"
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DutyPayload {
    pub roster: Vec<Value>,
    pub rules: Vec<Value>,
    pub exceptions: Vec<Value>,
    #[serde(default)]
    pub calendar: Vec<Value>,
    #[serde(default)]
    pub leave: Vec<Value>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DutySnapshot {
    pub account_id: Option<String>,
    pub payload: Option<DutyPayload>,
    pub last_synced_at: Option<i64>,
    pub error: Option<String>,
    pub cached: bool,
}
type Result<T> = std::result::Result<T, AppError>;
fn contract() -> AppError {
    AppError::new("contract", "值日表结构或分页发生变化，请检查配置后刷新。")
}
fn table(cli: &dyn Cli, id: &str, fields: &[(&str, &str)]) -> Result<(Vec<Value>, Value)> {
    let mut offset = 0;
    let mut records = vec![];
    let mut revision = None;
    for _ in 0..50 {
        let offset_text = offset.to_string();
        let mut args = vec![
            "base",
            "+record-list",
            "--as",
            "user",
            "--base-token",
            BASE,
            "--table-id",
            id,
            "--limit",
            "200",
            "--offset",
            &offset_text,
            "--json",
        ];
        for (field, _) in fields {
            args.extend(["--field-id", field]);
        }
        let response = cli.call(&args, Duration::from_secs(30))?;
        let data = &response["data"];
        let ids = data["field_id_list"].as_array().ok_or_else(contract)?;
        let rows = data["data"].as_array().ok_or_else(contract)?;
        let more = data["has_more"].as_bool().ok_or_else(contract)?;
        let rev = data
            .get("rev")
            .filter(|v| !v.is_null())
            .ok_or_else(contract)?;
        if revision.as_ref().is_some_and(|r| r != rev) {
            return Err(AppError::new("conflict", "值日表正在修改，请稍后刷新。"));
        }
        revision = Some(rev.clone());
        let indices: Vec<usize> = fields
            .iter()
            .map(|(field, _)| {
                ids.iter()
                    .position(|id| id.as_str() == Some(field))
                    .ok_or_else(contract)
            })
            .collect::<Result<_>>()?;
        for row in rows {
            let cells = row
                .as_array()
                .filter(|r| r.len() == ids.len())
                .ok_or_else(contract)?;
            let mut mapped = Map::new();
            for ((_, key), index) in fields.iter().zip(&indices) {
                mapped.insert((*key).into(), cells[*index].clone());
            }
            records.push(Value::Object(mapped));
        }
        if !more {
            return Ok((records, revision.unwrap()));
        }
        if rows.is_empty() {
            return Err(contract());
        }
        offset += rows.len();
    }
    Err(AppError::new(
        "contract",
        "值日表超过读取范围，保留上次完整缓存。",
    ))
}
const RULE_FIELDS: &[(&str, &str)] = &[
    (RULE_START_DATE, "startDate"),
    (RULE_DAILY_COUNT, "dailyCount"),
    (RULE_WEEK_ANCHOR, "singleWeekAnchor"),
    (RULE_ENABLED, "enabled"),
    (RULE_LEAVE_POLICY, "leavePolicy"),
];
pub fn load(cli: &dyn Cli) -> Result<DutyPayload> {
    let (rules, before) = table(cli, TABLE_RULES, RULE_FIELDS)?;
    let (roster, _) = table(
        cli,
        TABLE_ROSTER,
        &[
            (ROSTER_PERSON, "person"),
            (ROSTER_ORDER, "order"),
            (ROSTER_INCLUDED, "included"),
        ],
    )?;
    let (exceptions, _) = table(
        cli,
        TABLE_EXCEPTIONS,
        &[
            (EXCEPTION_DATE, "date"),
            (EXCEPTION_KIND, "kind"),
            (EXCEPTION_PEOPLE, "people"),
            (EXCEPTION_NOTE, "note"),
            (EXCEPTION_SWAP_DATE, "swapDate"),
        ],
    )?;
    let (calendar, _) = table(
        cli,
        TABLE_CALENDAR,
        &[
            (CALENDAR_DATE, "date"),
            (CALENDAR_KIND, "kind"),
            (CALENDAR_NOTE, "note"),
        ],
    )?;
    let (leave, _) = table(
        cli,
        TABLE_LEAVE,
        &[
            (LEAVE_PERSON, "person"),
            (LEAVE_START_DATE, "startDate"),
            (LEAVE_END_DATE, "endDate"),
            (LEAVE_NOTE, "note"),
        ],
    )?;
    let (_, after) = table(cli, TABLE_RULES, RULE_FIELDS)?;
    if before != after {
        return Err(AppError::new("conflict", "值日规则正在修改，请稍后刷新。"));
    }
    Ok(DutyPayload {
        roster,
        rules,
        exceptions,
        calendar,
        leave,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex;
    struct Mock {
        pages: Mutex<Vec<Value>>,
        args: Mutex<Vec<Vec<String>>>,
    }
    impl Cli for Mock {
        fn call(&self, args: &[&str], _: Duration) -> Result<Value> {
            self.args
                .lock()
                .unwrap()
                .push(args.iter().map(|s| s.to_string()).collect());
            Ok(self.pages.lock().unwrap().remove(0))
        }
    }
    fn page(cells: Value, more: bool, rev: u32) -> Value {
        json!({"data":{"field_id_list":["f1"],"data":cells,"has_more":more,"rev":rev}})
    }
    #[test]
    fn reads_complete_pages_and_uses_user_read_only_command() {
        let mock = Mock {
            pages: Mutex::new(vec![
                page(json!([["a"]]), true, 1),
                page(json!([["b"]]), false, 1),
            ]),
            args: Mutex::new(vec![]),
        };
        let (rows, _) = table(&mock, "test", &[("f1", "name")]).unwrap();
        assert_eq!(rows, vec![json!({"name":"a"}), json!({"name":"b"})]);
        let args = mock.args.lock().unwrap();
        assert!(args
            .iter()
            .all(|a| a[1] == "+record-list" && a.windows(2).any(|w| w == ["--as", "user"])));
        assert!(args[1].windows(2).any(|w| w == ["--offset", "1"]));
    }
    #[test]
    fn rejects_partial_changed_and_missing_fields() {
        for pages in [
            vec![page(json!([]), true, 1)],
            vec![
                page(json!([["a"]]), true, 1),
                page(json!([["b"]]), false, 2),
            ],
            vec![json!({"data":{"data":[],"field_id_list":[],"has_more":false,"rev":1}})],
        ] {
            let mock = Mock {
                pages: Mutex::new(pages),
                args: Mutex::new(vec![]),
            };
            assert!(table(&mock, "test", &[("f1", "name")]).is_err());
        }
    }
}
