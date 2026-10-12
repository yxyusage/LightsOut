/**
 * 熄灯早睡 · 睡眠计划与相位判定
 *
 * 这里是 PRD 2.1「睡眠计划管理」与 2.2.1「进入触发逻辑」的纯逻辑实现。
 * 关键点：熄灯时段支持跨天（23:00 → 次日 07:00），所以判定"此刻是否在熄灯中"
 * 必须同时检查"今天开启的时段"和"昨天开启的时段"。
 *
 * 依赖方向：schedule → constants / time / holidays，三者都不反向依赖本模块，依赖图无环。
 */

import { DAY_TYPE, PHASE } from "./constants.js";
import { isMakeupWorkday } from "./holidays.js";
import {
  MINUTES_PER_DAY,
  MS_MINUTE,
  addDays,
  addMinutes,
  dateKey,
  isWeekend,
  startOfDay,
  toMinutes,
} from "./time.js";

/**
 * 判定某一天按哪套时段执行。
 *
 * 相比 PRD 的"工作日/周末"二分，这里多加了两层处理：
 * - **调休上班日**：法定调休把某个周六变成上班日，用户当天仍在上班，晚上理应按工作日时段熄灯；
 *   若希望严格照搬 PRD 字面语义，把 `respectMakeupWorkdays` 设为 false 即可。
 * - **周日晚按工作日**（`sundayAsWeekday`，默认开）：多数用户周一要早起上班，
 *   周日晚上若套用"周末晚睡时段"会失去保护，因此把周日开启的时段按工作日配置执行；
 *   周六仍按周末配置。
 */
export function dayTypeOf(date, options = {}) {
  const { respectMakeupWorkdays = true, sundayAsWeekday = true } = options;
  if (respectMakeupWorkdays && isMakeupWorkday(date)) return DAY_TYPE.WEEKDAY;
  if (sundayAsWeekday && date.getDay() === 0) return DAY_TYPE.WEEKDAY;
  return isWeekend(date) ? DAY_TYPE.WEEKEND : DAY_TYPE.WEEKDAY;
}

/**
 * 构造"以某一天为起点"的熄灯区间。
 * @param {{windows: Record<string, {start: string, end: string}>}} plan
 * @param {Date} date 区间**开始**的那一天
 * @returns {{start: Date, end: Date, dayType: string, crossesMidnight: boolean, startKey: string, durationMs: number}|null}
 */
export function windowForDate(plan, date, options = {}) {
  if (!plan?.windows) return null;
  const dayType = dayTypeOf(date, options);
  const config = plan.windows[dayType];
  if (!config?.start || !config?.end) return null;

  const startMinutes = toMinutes(config.start);
  const endMinutes = toMinutes(config.end);
  // start === end 视为未配置（既非 0 分钟也非 24 小时，语义含糊），交由 UI 校验提示
  if (startMinutes === endMinutes) return null;

  const crossesMidnight = endMinutes < startMinutes;
  const day = startOfDay(date);
  const start = addMinutes(day, startMinutes);
  const end = addMinutes(day, crossesMidnight ? endMinutes + MINUTES_PER_DAY : endMinutes);

  return {
    start,
    end,
    dayType,
    crossesMidnight,
    startKey: dateKey(date),
    durationMs: end.getTime() - start.getTime(),
  };
}

/**
 * 此刻是否处于熄灯时段内；是则返回该区间。
 * 只需检查偏移 0 与 -1 天：单次时段必然短于 24 小时。
 */
export function activeWindowAt(plan, now, options = {}) {
  if (!plan?.enabled) return null;
  for (const offset of [0, -1]) {
    const window = windowForDate(plan, addDays(now, offset), options);
    if (window && now >= window.start && now < window.end) return window;
  }
  return null;
}

/** 此刻之后最早开始的熄灯区间 */
export function nextWindowAt(plan, now, options = {}) {
  if (!plan?.enabled) return null;
  let earliest = null;
  for (const offset of [0, 1, 2]) {
    const window = windowForDate(plan, addDays(now, offset), options);
    if (window && window.start > now && (!earliest || window.start < earliest.start)) {
      earliest = window;
    }
  }
  return earliest;
}

/**
 * 求此刻的引擎相位。这是整个应用唯一的时间判定入口。
 *
 * @param {object} plan  `settings.plan`
 * @param {Date}   now
 * @param {{warnMinutes?: number, dismissedWindowKey?: string|null, respectMakeupWorkdays?: boolean}} [options]
 * @returns {{
 *   phase: "off"|"idle"|"warning"|"active",
 *   window: object|null,
 *   remainingMs: number,
 *   warnMs: number,
 *   dismissed: boolean
 * }}
 */
export function phaseAt(plan, now, options = {}) {
  const {
    warnMinutes = plan?.warnMinutes ?? 0,
    dismissedWindowKey = null,
    respectMakeupWorkdays = true,
    sundayAsWeekday = true,
  } = options;
  const scheduleOptions = { respectMakeupWorkdays, sundayAsWeekday };

  if (!plan?.enabled) {
    return { phase: PHASE.OFF, window: null, remainingMs: 0, warnMs: 0, dismissed: false };
  }

  const active = activeWindowAt(plan, now, scheduleOptions);
  if (active) {
    // 紧急解除只作用于"当前这一次"时段，次日计划照常生效（PRD 2.2.5）
    const dismissed = dismissedWindowKey === active.startKey;
    return {
      phase: dismissed ? PHASE.OFF : PHASE.ACTIVE,
      window: active,
      remainingMs: Math.max(0, active.end.getTime() - now.getTime()),
      warnMs: 0,
      dismissed,
    };
  }

  const next = nextWindowAt(plan, now, scheduleOptions);
  if (!next) {
    return { phase: PHASE.IDLE, window: null, remainingMs: 0, warnMs: 0, dismissed: false };
  }

  const untilStartMs = next.start.getTime() - now.getTime();
  const warnMs = Math.max(0, warnMinutes) * MS_MINUTE;
  const inWarning = warnMs > 0 && untilStartMs <= warnMs;

  return {
    phase: inWarning ? PHASE.WARNING : PHASE.IDLE,
    window: next,
    remainingMs: untilStartMs,
    warnMs,
    dismissed: false,
  };
}

/**
 * 校验一套时段配置，返回人类可读的问题列表（空数组表示合法）。
 * UI 在用户编辑时段时实时调用。
 */
export function validateWindow({ start, end }) {
  const problems = [];
  let startMinutes = null;
  let endMinutes = null;

  try {
    startMinutes = toMinutes(start);
  } catch {
    problems.push("开始时间格式应为 HH:MM");
  }
  try {
    endMinutes = toMinutes(end);
  } catch {
    problems.push("结束时间格式应为 HH:MM");
  }
  if (problems.length) return problems;

  if (startMinutes === endMinutes) {
    problems.push("开始时间与结束时间不能相同");
    return problems;
  }

  const durationMinutes = (endMinutes - startMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  if (durationMinutes < 30) problems.push("熄灯时段不应短于 30 分钟");
  if (durationMinutes > 16 * 60) problems.push("熄灯时段不宜长于 16 小时");

  return problems;
}
