// Copy to duty-config.local.rs and fill your own Feishu identifiers.
pub const BASE: &str = "YOUR_BASE_TOKEN";
pub const DOC_URL: &str = "https://example.feishu.cn/docx/YOUR_DOCUMENT_TOKEN";
pub const BASE_URL: &str = "https://example.feishu.cn/base/YOUR_BASE_TOKEN";
pub const TABLE_SCHEDULE: &str = "tbl_weekly_duty_schedule";
pub const SCHEDULE_DATE: &str = "fld_schedule_date";
pub const SCHEDULE_KIND: &str = "fld_schedule_kind";
pub const SCHEDULE_PEOPLE: &str = "fld_schedule_people";
pub const SCHEDULE_NOTE: &str = "fld_schedule_note";
pub const SCHEDULE_WEEK_START: &str = "fld_schedule_week_start";
pub const SCHEDULE_REST_DAYS: &str = "fld_schedule_rest_days";
pub const SCHEDULE_WEEK_PEOPLE: &[&str] = &[
    "fld_schedule_mon_people",
    "fld_schedule_tue_people",
    "fld_schedule_wed_people",
    "fld_schedule_thu_people",
    "fld_schedule_fri_people",
    "fld_schedule_sat_people",
    "fld_schedule_sun_people",
];
