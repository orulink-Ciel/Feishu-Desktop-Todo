import { describe, expect, it } from "vitest";
import {
  dayNumber,
  defaultWorkday,
  dutyForDate,
  manualDutyForDate,
} from "./duty";
import type { DutyPayload } from "./types";
const person = (id: string, name = id) => ({ id: "ou_" + id, name });
const config = (): DutyPayload => ({
  roster: ["A", "B", "C"].map((name, i) => ({
    person: [person(name)],
    order: i + 1,
    included: true,
  })),
  rules: [
    {
      enabled: true,
      startDate: "2026-10-10T00:00:00.000+08:00",
      dailyCount: 1,
      singleWeekAnchor: "2026-10-05T00:00:00.000+08:00",
    },
  ],
  exceptions: [],
  leave: [],
  calendar: [{ date: "2026-01-01", kind: "年度已核验" }],
});
const names = (p: DutyPayload, date: string) =>
  dutyForDate(p, date).people.map((p) => p.name);
describe("company duty rotation", () => {
  it("automatically skips official holidays and includes official makeup days", () => {
    const p = config();
    p.rules[0].startDate = "2026-10-05";
    for (let d = 1; d <= 7; d++)
      p.calendar.push({ date: `2026-10-0${d}`, kind: "休息", note: "国庆节" });
    expect(dutyForDate(p, "2026-10-05").state).toBe("rest");
    expect(names(p, "2026-10-08")).toEqual(["A"]);
    expect(names(p, "2026-10-12")).toEqual(["A"]);
    p.rules[0].startDate = "2026-09-18";
    p.calendar.push({ date: "2026-09-20", kind: "补班" });
    expect(names(p, "2026-09-20")).toEqual(["B"]);
    p.exceptions = [
      { date: "2026-10-05", kind: "补班", people: [person("C")] },
    ];
    expect(names(p, "2026-10-05")).toEqual(["C"]);
  });
  it("fails visibly when a required calendar year has not been verified", () => {
    expect(dutyForDate(config(), "2027-01-01").message).toContain(
      "2027 年节假日日历尚未核验",
    );
    const p = config();
    p.calendar = [];
    expect(dutyForDate(p, "2026-10-12").state).toBe("invalid");
    p.calendar = [
      { date: "2026-01-01", kind: "年度已核验" },
      { date: "2026-01-02", kind: "年度已核验" },
    ];
    expect(dutyForDate(p, "2026-10-12").state).toBe("invalid");
  });
  it("requires manual cover during inclusive leave and keeps later turns intact", () => {
    const p = config();
    p.rules[0].leavePolicy = "手动代班";
    p.leave = [
      { person: [person("B")], startDate: "2026-10-12", endDate: "2026-10-12" },
    ];
    expect(dutyForDate(p, "2026-10-12").state).toBe("needsReplacement");
    expect(names(p, "2026-10-13")).toEqual(["C"]);
    p.exceptions = [
      { date: "2026-10-12", kind: "换人", people: [person("C")] },
    ];
    expect(names(p, "2026-10-12")).toEqual(["C"]);
    expect(names(p, "2026-10-13")).toEqual(["C"]);
    p.exceptions[0].people = [person("B")];
    expect(dutyForDate(p, "2026-10-12").state).toBe("needsReplacement");
  });
  it("supports selectable leave policies without selecting the same person twice", () => {
    const p = config();
    p.leave = [
      { person: [person("A")], startDate: "2026-10-10", endDate: "2026-10-10" },
    ];
    p.rules[0].leavePolicy = "顺延补值";
    expect(names(p, "2026-10-10")).toEqual(["B"]);
    expect(names(p, "2026-10-12")).toEqual(["A"]);
    p.rules[0].leavePolicy = "跳过本次";
    expect(names(p, "2026-10-10")).toEqual(["B"]);
    expect(names(p, "2026-10-12")).toEqual(["C"]);
    p.rules[0].dailyCount = 3;
    expect(dutyForDate(p, "2026-10-10").state).toBe("needsReplacement");
  });
  it("defers a business-travel absence across workdays and restores the turn after return", () => {
    const p = config();
    p.rules[0].leavePolicy = "顺延补值";
    p.leave = [
      { person: [person("A")], startDate: "2026-10-10", endDate: "2026-10-12" },
    ];
    expect(names(p, "2026-10-10")).toEqual(["B"]);
    expect(names(p, "2026-10-12")).toEqual(["C"]);
    expect(names(p, "2026-10-13")).toEqual(["A"]);
    expect(names(p, "2026-10-14")).toEqual(["B"]);
  });
  it("uses only manual date assignments and ignores legacy travel records", () => {
    const p = config();
    p.rules[0].enabled = false;
    p.exceptions = [
      {
        date: "2026-10-20",
        kind: "值日",
        people: [person("B")],
      },
      {
        date: null,
        kind: "出差",
        people: [person("B")],
        startDate: "2026-10-20",
        endDate: "2026-10-22",
      },
    ];
    expect(manualDutyForDate(p, "2026-10-20").state).toBe("ready");
    expect(manualDutyForDate(p, "2026-10-20").people).toEqual([person("B")]);
    expect(manualDutyForDate(p, "2026-10-21").state).toBe("unplanned");
    p.exceptions[0].people = [person("A")];
    expect(manualDutyForDate(p, "2026-10-20").people).toEqual([person("A")]);
  });
  it("ignores saved leave for a member who is no longer participating", () => {
    const p = config();
    p.roster[0].included = false;
    p.leave = [
      { person: [person("A")], startDate: "2026-10-10", endDate: "2026-10-20" },
    ];
    expect(names(p, "2026-10-10")).toEqual(["B"]);
    expect(names(p, "2026-10-12")).toEqual(["C"]);
  });
  it("swaps two whole-day assignments using one record without changing later rotation", () => {
    const p = config();
    p.exceptions = [
      { date: "2026-10-10", kind: "互换", swapDate: "2026-10-12" },
    ];
    expect(names(p, "2026-10-10")).toEqual(["B"]);
    expect(names(p, "2026-10-12")).toEqual(["A"]);
    expect(names(p, "2026-10-13")).toEqual(["C"]);
    p.leave = [
      { person: [person("A")], startDate: "2026-10-10", endDate: "2026-10-10" },
    ];
    expect(names(p, "2026-10-10")).toEqual(["B"]);
    p.leave[0].endDate = "2026-10-12";
    expect(dutyForDate(p, "2026-10-10").state).toBe("invalid");
  });
  it("rejects conflicting swaps, unavailable identities and malformed leave ranges", () => {
    const cases: ((p: DutyPayload) => void)[] = [
      (p) => {
        p.exceptions = [
          { date: "2026-10-10", kind: "互换", swapDate: "2026-10-11" },
        ];
      },
      (p) => {
        p.exceptions = [
          { date: "2026-10-10", kind: "互换", swapDate: "2026-10-12" },
          { date: "2026-10-12", kind: "换人", people: [person("C")] },
        ];
      },
      (p) => {
        p.leave = [
          {
            person: [person("departed")],
            startDate: "2026-10-10",
            endDate: "2026-10-12",
          },
        ];
      },
      (p) => {
        p.leave = [
          {
            person: [person("A")],
            startDate: "2026-10-13",
            endDate: "2026-10-12",
          },
        ];
      },
      (p) => {
        p.calendar.push(
          { date: "2026-10-12", kind: "休息" },
          { date: "2026-10-12", kind: "补班" },
        );
      },
    ];
    for (const change of cases) {
      const p = config();
      change(p);
      expect(dutyForDate(p, "2026-10-12").state).toBe("invalid");
    }
  });
  it("uses the fixed week anchor across months and years", () => {
    const anchor = dayNumber("2026-10-05");
    for (const [date, works] of [
      ["2026-10-10", true],
      ["2026-10-11", false],
      ["2026-10-17", false],
      ["2026-10-24", true],
      ["2027-01-02", true],
      ["2027-01-09", false],
    ] as const)
      expect(defaultWorkday(dayNumber(date), anchor)).toBe(works);
  });
  it("skips rest dates without consuming the sequence", () => {
    const p = config();
    expect(names(p, "2026-10-10")).toEqual(["A"]);
    expect(dutyForDate(p, "2026-10-11").state).toBe("rest");
    expect(names(p, "2026-10-12")).toEqual(["B"]);
    expect(names(p, "2026-10-19")).toEqual(["A"]);
  });
  it("rotates multiple people and wraps without duplicate assignments", () => {
    const p = config();
    p.rules[0].dailyCount = 2;
    expect(names(p, "2026-10-10")).toEqual(["A", "B"]);
    expect(names(p, "2026-10-12")).toEqual(["C", "A"]);
  });
  it("respects rest, makeup days and replacements independently", () => {
    const p = config();
    p.exceptions = [
      { date: "2026-10-12", kind: "休息", people: null },
      { date: "2026-10-17", kind: "补班", people: [person("C")] },
      { date: "2026-10-13", kind: "换人", people: [person("A")] },
    ];
    expect(dutyForDate(p, "2026-10-12").state).toBe("rest");
    expect(names(p, "2026-10-13")).toEqual(["A"]);
    expect(names(p, "2026-10-14")).toEqual(["C"]);
    expect(names(p, "2026-10-17")).toEqual(["C"]);
    expect(names(p, "2026-10-19")).toEqual(["A"]);
  });
  it("uses explicit order and excludes departing members", () => {
    const p = config();
    p.roster[0].included = false;
    p.roster[2].order = 1;
    expect(names(p, "2026-10-10")).toEqual(["C"]);
  });
  it("adds a new colleague from an effective date without changing earlier assignments", () => {
    const original = config();
    const expanded = config();
    expanded.roster.push({
      person: [person("D")],
      order: 4,
      included: true,
      startDate: "2026-10-15",
      endDate: null,
    });
    for (const date of ["2026-10-10", "2026-10-12", "2026-10-13", "2026-10-14"])
      expect(names(expanded, date)).toEqual(names(original, date));
    expect(names(expanded, "2026-10-15")).toEqual(["B"]);
    expect(names(expanded, "2026-10-20")).toEqual(["D"]);
  });
  it("keeps a departing colleague in past rotation and removes them after their end date", () => {
    const p = config();
    p.roster[2].endDate = "2026-10-13";
    expect(names(p, "2026-10-10")).toEqual(["A"]);
    expect(names(p, "2026-10-12")).toEqual(["B"]);
    expect(names(p, "2026-10-13")).toEqual(["C"]);
    expect(names(p, "2026-10-14")).toEqual(["A"]);
  });
  it("keeps same-name people separate by their Feishu identity", () => {
    const p = config();
    p.roster[0].person = [person("A", "同名")];
    p.roster[1].person = [person("B", "同名")];
    expect(dutyForDate(p, "2026-10-10").people[0].id).toBe("ou_A");
    expect(dutyForDate(p, "2026-10-12").people[0].id).toBe("ou_B");
  });
  it("does not invent assignments before setup or the effective date", () => {
    const p = config();
    expect(dutyForDate(null, "2026-10-12").state).toBe("unconfigured");
    p.rules[0].enabled = false;
    expect(dutyForDate(p, "2026-10-12").state).toBe("unconfigured");
    p.rules[0].enabled = true;
    p.rules[0].startDate = "2026-10-20";
    expect(dutyForDate(p, "2026-10-12").state).toBe("future");
    p.roster = [];
    expect(dutyForDate(p, "2026-10-12").state).toBe("unconfigured");
  });
  it("rejects ambiguous rules, people, dates and counts", () => {
    const cases: ((p: DutyPayload) => void)[] = [
      (p) => p.rules.push(p.rules[0]),
      (p) => {
        p.roster[1].order = 1;
      },
      (p) => {
        p.roster[1].person = p.roster[0].person;
      },
      (p) => {
        p.rules[0].dailyCount = 4;
      },
      (p) => {
        p.rules[0].startDate = "2026-02-30";
      },
      (p) => {
        p.exceptions = [
          { date: "2026-10-12", kind: "休息" },
          { date: "2026-10-12", kind: "补班" },
        ];
      },
      (p) => {
        p.exceptions = [
          { date: "2026-10-11", kind: "换人", people: [person("A")] },
        ];
      },
      (p) => {
        p.exceptions = [
          { date: "2026-10-12", kind: "换人", people: [person("departed")] },
        ];
      },
    ];
    for (const change of cases) {
      const p = config();
      change(p);
      expect(dutyForDate(p, "2026-10-12").state).toBe("invalid");
    }
  });
  it("expands one weekly row into daily assignments and distinguishes rest from missing entries", () => {
    const p = config();
    p.weekly = [
      {
        weekStart: "2026-10-19T00:00:00.000+08:00",
        restDays: ["周六", "周日"],
        tuePeople: [person("A", "郑同事")],
      },
    ];
    expect(manualDutyForDate(p, "2026-10-20")).toMatchObject({
      state: "ready",
      people: [{ id: "ou_A", name: "郑同事" }],
    });
    expect(manualDutyForDate(p, "2026-10-21")).toMatchObject({
      state: "unplanned",
      message: "待填写值日人员",
    });
    expect(manualDutyForDate(p, "2026-10-24").state).toBe("rest");
    expect(manualDutyForDate(p, "2026-10-25").state).toBe("rest");
  });
  it("requires a Monday week anchor and lets a weekly row supersede migrated daily entries", () => {
    const p = config();
    p.weekly = [
      {
        weekStart: "2026-10-19",
        restDays: [],
        tuePeople: [person("A", "新排班")],
      },
    ];
    p.exceptions = [
      { date: "2026-10-20", kind: "值日", people: [person("B", "旧排班")] },
    ];
    expect(manualDutyForDate(p, "2026-10-20").people[0].name).toBe("新排班");
    p.weekly[0].weekStart = "2026-10-20";
    expect(manualDutyForDate(p, "2026-10-20").state).toBe("invalid");
  });
});
