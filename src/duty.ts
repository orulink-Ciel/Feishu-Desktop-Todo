import type { DutyPayload } from "./types";
import { dateKey } from "./tasks";
export interface DutyPerson {
  id: string;
  name: string;
}
export interface DutyResult {
  state:
    | "ready"
    | "rest"
    | "unconfigured"
    | "future"
    | "invalid"
    | "needsReplacement"
    | "unplanned";
  message: string;
  people: DutyPerson[];
  note?: string;
}
const dayMs = 86400000;
const fail = (message: string): never => {
  throw new Error(message);
};
export function dayNumber(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("日期格式无效");
  const at = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== date)
    return fail("日期无效");
  return at / dayMs;
}
function calendarDate(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    dayNumber(value);
    return value;
  }
  const at =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Date.parse(value)
        : NaN;
  if (!Number.isFinite(at)) return fail("请填写完整的日期");
  return dateKey(at);
}
function people(value: unknown): DutyPerson[] {
  if (value == null) return [];
  if (!Array.isArray(value)) return fail("人员字段格式无效，请选择飞书人员");
  return value.map((v: Record<string, unknown>) => {
    if (!v || typeof v.id !== "string" || !v.id.startsWith("ou_"))
      return fail("人员身份无效");
    const name = v.name ?? v.localized_name ?? v.text;
    if (typeof name !== "string" || !name.trim())
      return fail("人员姓名缺失，请刷新或检查人员字段");
    return { id: v.id, name: name.trim() };
  });
}
function choice(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length === 1) return choice(value[0]);
  if (value && typeof value === "object" && "name" in value)
    return choice(value.name);
  return fail("请填写安排类型");
}
function choices(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(choice);
  return [choice(value)];
}
export function defaultWorkday(day: number, anchor: number): boolean {
  const weekday = new Date(day * dayMs).getUTCDay();
  const anchorWeekday = new Date(anchor * dayMs).getUTCDay();
  const monday = anchor - ((anchorWeekday + 6) % 7);
  return (
    (weekday >= 1 && weekday <= 5) ||
    (weekday === 6 && Math.floor((day - monday) / 7) % 2 === 0)
  );
}
export function dutyForDate(
  payload: DutyPayload | null,
  date: string,
): DutyResult {
  const result = (
    state: DutyResult["state"],
    message: string,
    people: DutyPerson[] = [],
    note?: string,
  ): DutyResult => ({ state, message, people, note });
  try {
    if (!payload || payload.rules.length === 0)
      return result("unconfigured", "值日未配置");
    if (payload.rules.length !== 1) return fail("轮值规则只能保留一条");
    const rule = payload.rules[0];
    if (rule.enabled !== true) return result("unconfigured", "值日未配置");
    const start = dayNumber(calendarDate(rule.startDate));
    const anchor = dayNumber(calendarDate(rule.singleWeekAnchor));
    const today = dayNumber(date);
    if (today - start > 366 * 50) return fail("开始日期过早，请检查轮值规则");
    const calendar = new Map<number, { kind: string; note?: string }>();
    const years = new Set<number>();
    for (const row of payload.calendar ?? []) {
      if (row.date == null && row.kind == null) continue;
      const day = dayNumber(calendarDate(row.date));
      const kind = choice(row.kind);
      const year = new Date(day * dayMs).getUTCFullYear();
      if (kind === "年度已核验") {
        if (years.has(year)) return fail("节假日日历的年度核验记录重复");
        years.add(year);
      } else {
        if (!["休息", "补班"].includes(kind) || calendar.has(day))
          return fail("节假日日历类型无效或日期重复");
        calendar.set(day, {
          kind,
          note: typeof row.note === "string" ? row.note : undefined,
        });
      }
    }
    const baseWorkday = (day: number) => {
      const year = new Date(day * dayMs).getUTCFullYear();
      if (!years.has(year))
        return fail(`${year} 年节假日日历尚未核验，请管理员补齐后刷新`);
      const entry = calendar.get(day);
      return entry ? entry.kind === "补班" : defaultWorkday(day, anchor);
    };
    const members = payload.roster
      .filter((r) => r.included === true)
      .map((r) => {
        const persons = people(r.person);
        if (persons.length !== 1) return fail("每条轮值名单请选择一位人员");
        if (
          typeof r.order !== "number" ||
          !Number.isInteger(r.order) ||
          r.order < 1
        )
          return fail("顺序必须是不重复的正整数");
        const from =
          r.startDate == null ? start : dayNumber(calendarDate(r.startDate));
        const to =
          r.endDate == null
            ? Number.POSITIVE_INFINITY
            : dayNumber(calendarDate(r.endDate));
        if (from > to) return fail("参与结束日不能早于参与开始日");
        return { ...persons[0], order: r.order, from, to };
      })
      .sort((a, b) => a.order - b.order);
    if (!members.length) return result("unconfigured", "值日名单尚未填写");
    if (new Set(members.map((m) => m.id)).size !== members.length)
      return fail("参与名单中存在重复人员");
    if (new Set(members.map((m) => m.order)).size !== members.length)
      return fail("轮值顺序重复，请调整编号");
    const count = rule.dailyCount;
    if (
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > members.length
    )
      return fail("每天人数须为 1 至参与人数之间的整数");
    const leave = (payload.leave ?? [])
      .filter(
        (row) =>
          row.person != null || row.startDate != null || row.endDate != null,
      )
      .flatMap((row) => {
        const persons = people(row.person);
        if (persons.length !== 1)
          return fail("请假人员须是参与名单中的一位人员");
        const member = members.find((m) => m.id === persons[0].id);
        if (!member) {
          // Old leave records of a now-excluded member do not stop today's roster.
          if (
            payload.roster.some(
              (r) =>
                Array.isArray(r.person) &&
                r.person.some((p) => p?.id === persons[0].id),
            )
          )
            return [];
          return fail("请假人员须是参与名单中的一位人员");
        }
        const from = dayNumber(calendarDate(row.startDate));
        const to = dayNumber(calendarDate(row.endDate));
        if (from > to) return fail("请假结束日期不能早于开始日期");
        if (from < member.from || to > member.to)
          return fail("请假日期须在该人员参与值日的有效期内");
        return [{ id: persons[0].id, from, to }];
      });
    const absent = (day: number, id: string) =>
      leave.some((l) => l.id === id && l.from <= day && day <= l.to);
    const policy =
      rule.leavePolicy == null ? "手动代班" : choice(rule.leavePolicy);
    if (!["顺延补值", "跳过本次", "手动代班"].includes(policy))
      return fail("请假处理规则无效");
    const exceptions = new Map<
      number,
      { kind: string; people: DutyPerson[]; note?: string }
    >();
    const swaps: { from: number; to: number; note?: string }[] = [];
    const occupied = new Set<number>();
    for (const row of payload.exceptions) {
      if (
        row.date == null &&
        row.kind == null &&
        row.people == null &&
        row.swapDate == null
      )
        continue;
      const day = dayNumber(calendarDate(row.date));
      if (occupied.has(day)) return fail("同一天有多条值日调整或互换，请合并");
      const kind = choice(row.kind);
      if (!["休息", "补班", "换人", "互换"].includes(kind))
        return fail("值日调整类型无效");
      const assigned = people(row.people);
      if (kind === "互换") {
        const target = dayNumber(calendarDate(row.swapDate));
        if (target === day || occupied.has(target) || assigned.length)
          return fail(
            "互换需两个不同日期，不填替班人员；日期不能与其他安排重叠",
          );
        if (
          Math.min(day, target) < start ||
          Math.max(day, target) - start > 366 * 50
        )
          return fail("互换日期须在轮值开始后，且不能超过 50 年");
        if (!baseWorkday(day) || !baseWorkday(target))
          return fail("互换的两天都必须是工作日");
        occupied.add(day);
        occupied.add(target);
        swaps.push({
          from: day,
          to: target,
          note: typeof row.note === "string" ? row.note : undefined,
        });
        continue;
      }
      if (row.swapDate != null) return fail("只有互换类型可以填写对调日期");
      occupied.add(day);
      if (new Set(assigned.map((p) => p.id)).size !== assigned.length)
        return fail("替班人员重复");
      if (kind === "换人" && !assigned.length)
        return fail("换人时请选择替班人员");
      if (kind === "休息" && assigned.length)
        return fail("休息日不能同时填写替班人员");
      const activeIds = new Set(
        members
          .filter((m) => m.from <= day && day <= m.to)
          .map((m) => m.id),
      );
      if (assigned.some((p) => !activeIds.has(p.id)))
        return fail("替班人员须在当日参与名单中");
      if (assigned.length && assigned.length !== count)
        return fail("替班人员数量应等于每天人数");
      if (kind === "换人" && !baseWorkday(day))
        return fail("休息日安排值日请选择补班");
      exceptions.set(day, {
        kind,
        people: assigned,
        note: typeof row.note === "string" ? row.note : undefined,
      });
    }
    if (today < start)
      return result("future", `轮值从 ${calendarDate(rule.startDate)} 开始`);
    const workday = (day: number) => {
      const override = exceptions.get(day);
      return override?.kind === "休息"
        ? false
        : override?.kind === "补班"
          ? true
          : baseWorkday(day);
    };
    if (!workday(today))
      return result(
        "rest",
        "今日无需值日",
        [],
        exceptions.get(today)?.note ?? calendar.get(today)?.note,
      );
    const queue: typeof members = [];
    const assignments = new Map<number, DutyPerson[]>();
    const last = Math.max(today, ...swaps.flatMap((s) => [s.from, s.to]));
    for (let day = start; day <= last; day++) {
      const activeMembers = members.filter(
        (member) => member.from <= day && day <= member.to,
      );
      const activeIds = new Set(activeMembers.map((member) => member.id));
      for (let i = queue.length - 1; i >= 0; i--) {
        if (!activeIds.has(queue[i].id)) queue.splice(i, 1);
      }
      const queuedIds = new Set(queue.map((member) => member.id));
      for (const member of activeMembers) {
        if (!queuedIds.has(member.id)) queue.push(member);
      }
      if (!workday(day)) continue;
      if (queue.length < count)
        return fail(
          `${new Date(day * dayMs).toISOString().slice(0, 10)} 的参与人数少于每天值日人数`,
        );
      const assigned: DutyPerson[] = [];
      if (policy === "手动代班") {
        const turns = queue.splice(0, count);
        queue.push(...turns);
        assigned.push(...turns);
      } else {
        // A deferred absence stays in place; a skipped turn moves to the tail.
        const candidates = [...queue];
        for (const member of candidates) {
          if (assigned.length === count) break;
          if (absent(day, member.id) && policy === "顺延补值") continue;
          queue.splice(
            queue.findIndex((m) => m.id === member.id),
            1,
          );
          queue.push(member);
          if (!absent(day, member.id)) assigned.push(member);
        }
      }
      const override = exceptions.get(day);
      assignments.set(
        day,
        override?.people.length ? override.people : assigned,
      );
    }
    for (const swap of swaps) {
      const a = assignments.get(swap.from),
        b = assignments.get(swap.to);
      if (!a || !b) return fail("互换日期没有有效排班");
      assignments.set(swap.from, b);
      assignments.set(swap.to, a);
    }
    const assigned = assignments.get(today) ?? [];
    const unavailable = assigned.filter((p) => absent(today, p.id));
    const swap = swaps.find((s) => s.from === today || s.to === today);
    if (assigned.length !== count || unavailable.length)
      return result(
        "needsReplacement",
        "需要管理员安排代班",
        [],
        unavailable.length
          ? `${unavailable.map((p) => p.name).join("、")}请假；请在“值日调整”中指定当日完整的值日人员。`
          : "可值日人数不足，请管理员调整请假或当日代班安排。",
      );
    // Reject a swap that silently sends an absent person to its other date.
    for (const s of swaps) {
      if (
        [s.from, s.to].some((day) =>
          (assignments.get(day) ?? []).some((p) => absent(day, p.id)),
        )
      )
        return fail("互换后的人员与请假冲突，请调整互换或请假日期");
    }
    const override = exceptions.get(today);
    return result(
      "ready",
      "今日值日",
      assigned,
      swap
        ? `${swap.note ? swap.note + " · " : ""}与 ${new Date((swap.from === today ? swap.to : swap.from) * dayMs).toISOString().slice(0, 10)} 互换`
        : (override?.note ?? calendar.get(today)?.note),
    );
  } catch (error) {
    return result(
      "invalid",
      error instanceof Error ? error.message : "请检查值日配置",
    );
  }
}

/** Reads explicit per-date assignments from Feishu; never infers a rotation. */
export function manualDutyForDate(
  payload: DutyPayload | null,
  date: string,
): DutyResult {
  const result = (
    state: DutyResult["state"],
    message: string,
    people: DutyPerson[] = [],
    note?: string,
  ): DutyResult => ({ state, message, people, note });
  try {
    if (!payload) return result("unconfigured", "值日未配置");
    const day = dayNumber(date);
    const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const validWeekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    const weeklyPlans = new Map<number, { kind: string; people: DutyPerson[]; note?: string }>();
    for (const row of payload.weekly ?? []) {
      if (row.weekStart == null) continue;
      const start = dayNumber(calendarDate(row.weekStart));
      if (new Date(start * dayMs).getUTCDay() !== 1)
        return fail("周起始日期必须选择星期一");
      const offset = day - start;
      if (offset < 0 || offset > 6) continue;
      const label = weekdayLabels[new Date(day * dayMs).getUTCDay()];
      const restDays = choices(row.restDays);
      if (restDays.some((restDay) => !validWeekdays.includes(restDay)))
        return fail("休息日字段只能选择周一至周日");
      const assigned = people(row[["monPeople", "tuePeople", "wedPeople", "thuPeople", "friPeople", "satPeople", "sunPeople"][offset]]);
      const plan = restDays.includes(label)
        ? { kind: "休息", people: assigned, note: typeof row.note === "string" ? row.note : undefined }
        : { kind: "值日", people: assigned, note: typeof row.note === "string" ? row.note : undefined };
      if (weeklyPlans.has(day)) return fail("同一周存在多条周排班记录");
      weeklyPlans.set(day, plan);
    }
    const plans: { kind: string; people: DutyPerson[]; note?: string }[] = [];
    for (const row of payload.exceptions ?? []) {
      const kind = row.kind == null ? "" : choice(row.kind);
      if (row.date == null) continue;
      if (weeklyPlans.has(dayNumber(calendarDate(row.date)))) continue;
      // Accept the former option name for stale local cache entries during upgrade.
      if (kind !== "值日" && kind !== "换人" && kind !== "休息") continue;
      if (dayNumber(calendarDate(row.date)) !== day) continue;
      plans.push({
        kind,
        people: people(row.people),
        note: typeof row.note === "string" ? row.note : undefined,
      });
    }
    if (plans.length > 1) return fail("同一天有多条值日安排，请合并");
    const plan = weeklyPlans.get(day) ?? plans[0];
    if (!plan) return result("unplanned", "待排班");
    if (plan.kind === "休息") {
      if (plan.people.length) return fail("休息日不能填写值日人员");
      return result("rest", "休息", [], plan.note);
    }
    if (!plan.people.length) return result("unplanned", "待填写值日人员", [], plan.note);
    if (new Set(plan.people.map((person) => person.id)).size !== plan.people.length)
      return fail("值日人员重复");
    return result("ready", "今日值日", plan.people, plan.note);
  } catch (error) {
    return result(
      "invalid",
      error instanceof Error ? error.message : "请检查值日安排",
    );
  }
}
