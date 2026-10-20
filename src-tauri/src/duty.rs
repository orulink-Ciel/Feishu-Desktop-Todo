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
    pub weekly: Vec<Value>,
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
const SCHEDULE_FIELDS: &[(&str, &str)] = &[
    (SCHEDULE_DATE, "date"),
    (SCHEDULE_KIND, "kind"),
    (SCHEDULE_PEOPLE, "people"),
    (SCHEDULE_NOTE, "note"),
];
const WEEK_FIELDS: &[(&str, &str)] = &[
    (SCHEDULE_WEEK_START, "weekStart"),
    (SCHEDULE_REST_DAYS, "restDays"),
];
pub fn load(cli: &dyn Cli) -> Result<DutyPayload> {
    let mut week_fields = WEEK_FIELDS.to_vec();
    const DAY_KEYS: [&str; 7] = [
        "monPeople",
        "tuePeople",
        "wedPeople",
        "thuPeople",
        "friPeople",
        "satPeople",
        "sunPeople",
    ];
    week_fields.extend(
        SCHEDULE_WEEK_PEOPLE
            .iter()
            .zip(DAY_KEYS)
            .map(|(id, key)| (*id, key)),
    );
    let mut all_fields = SCHEDULE_FIELDS.to_vec();
    all_fields.extend(week_fields);
    let (rows, _) = table(cli, TABLE_SCHEDULE, &all_fields)?;
    let schedule = rows
        .iter()
        .filter(|row| !row["date"].is_null())
        .cloned()
        .collect();
    let weekly = rows
        .into_iter()
        .filter(|row| !row["weekStart"].is_null())
        .collect();
    Ok(DutyPayload {
        roster: vec![],
        rules: vec![],
        exceptions: schedule,
        weekly,
        calendar: vec![],
        leave: vec![],
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
    fn page_with_fields(fields: &[&str], rows: Value, rev: u32) -> Value {
        json!({"data":{"field_id_list":fields,"data":rows,"has_more":false,"rev":rev}})
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
    #[test]
    fn loads_manual_schedule_from_one_table() {
        let mut schedule_fields: Vec<&str> =
            SCHEDULE_FIELDS.iter().map(|(field, _)| *field).collect();
        schedule_fields.extend(WEEK_FIELDS.iter().map(|(field, _)| *field));
        schedule_fields.extend(SCHEDULE_WEEK_PEOPLE);
        let mut legacy_row = vec![
            json!("2026-10-20"),
            json!(["值日"]),
            Value::Null,
            json!("plan"),
            Value::Null,
            Value::Null,
        ];
        legacy_row.extend((0..7).map(|_| Value::Null));
        let mut weekly_row = vec![
            Value::Null,
            Value::Null,
            Value::Null,
            json!("weekly note"),
            json!("2026-10-19"),
            json!(["周六", "周日"]),
            Value::Null,
            json!([{"id":"ou_A", "name":"郑同事"}]),
        ];
        weekly_row.extend((0..5).map(|_| Value::Null));
        let mock = Mock {
            pages: Mutex::new(vec![page_with_fields(
                &schedule_fields,
                json!([legacy_row, weekly_row]),
                1,
            )]),
            args: Mutex::new(vec![]),
        };
        let payload = load(&mock).unwrap();
        assert_eq!(payload.exceptions[0]["date"], "2026-10-20");
        assert_eq!(payload.exceptions[0]["kind"][0], "值日");
        assert_eq!(payload.weekly.len(), 1);
        assert_eq!(payload.weekly[0]["weekStart"], "2026-10-19");
        assert_eq!(payload.weekly[0]["tuePeople"][0]["id"], "ou_A");
        assert!(payload.leave.is_empty());
        let args = mock.args.lock().unwrap();
        assert_eq!(args.len(), 1);
        assert_eq!(
            args.iter()
                .filter(|call| call
                    .windows(2)
                    .any(|pair| pair == ["--table-id", TABLE_SCHEDULE]))
                .count(),
            1
        );
    }
}
