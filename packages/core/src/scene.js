/**
 * 熄灯早睡 · 场景识别
 *
 * PRD 2.4 要求「识别日期属性（周五晚、周末、法定节假日）、时间节点，生成对应安抚语」。
 * 本模块把"现在是怎样的一个夜晚"抽象成一个结构化场景对象，本地文案库与 AI 提示词
 * 共用同一份判定结果，保证两条路径的语气与事实完全一致。
 */

import { holidayContext, isMakeupWorkday } from "./holidays.js";
import { TIME_BUCKET_LABELS, dateKey, timeBucketOf, weekdayName, isWeekend } from "./time.js";

/** 场景标识。优先级从上到下，`detectScene` 取第一个命中的作为主场景。 */
export const SCENE = {
  /** 假期的最后一晚——最需要提醒"明天要收心了" */
  HOLIDAY_LAST_NIGHT: "holiday-last-night",
  /** 假期前夜——最放松、最容易熬夜的一晚 */
  HOLIDAY_EVE: "holiday-eve",
  /** 假期进行中 */
  HOLIDAY: "holiday",
  /** 周五晚 */
  FRIDAY_NIGHT: "friday-night",
  /** 周六晚 */
  SATURDAY_NIGHT: "saturday-night",
  /** 周日晚——"周一焦虑"高发时段 */
  SUNDAY_NIGHT: "sunday-night",
  /** 调休上班日的晚上 */
  MAKEUP_WORKDAY_NIGHT: "makeup-workday-night",
  /** 普通工作日晚 */
  ORDINARY: "ordinary",
};

export const SCENE_LABELS = {
  [SCENE.HOLIDAY_LAST_NIGHT]: "假期最后一晚",
  [SCENE.HOLIDAY_EVE]: "假期前夜",
  [SCENE.HOLIDAY]: "假期中",
  [SCENE.FRIDAY_NIGHT]: "周五晚",
  [SCENE.SATURDAY_NIGHT]: "周六晚",
  [SCENE.SUNDAY_NIGHT]: "周日晚",
  [SCENE.MAKEUP_WORKDAY_NIGHT]: "调休上班日晚",
  [SCENE.ORDINARY]: "普通工作日晚",
};

/**
 * 识别此刻的场景。
 * @param {Date} now
 * @param {{respectMakeupWorkdays?: boolean}} [options]
 */
export function detectScene(now, options = {}) {
  const { respectMakeupWorkdays = true } = options;
  const day = now.getDay();
  const context = holidayContext(now);

  const holidayToday = context.today?.kind === "holiday" ? context.today : null;
  const holidayTomorrow = context.tomorrow?.kind === "holiday" ? context.tomorrow : null;
  const holidayYesterday = context.yesterday?.kind === "holiday" ? context.yesterday : null;

  // "假期前夜"必须是"今天还在上班、明天开始放假"；
  // 若今天本身已在假期中（如 10-02，明天 10-03 也是假期），则不算前夜。
  const isHolidayEve = !holidayToday && Boolean(holidayTomorrow);
  const isHolidayLastNight = Boolean(holidayToday) && !holidayTomorrow;
  const isHolidayOngoing = Boolean(holidayToday) && !isHolidayLastNight;
  const isMakeup = respectMakeupWorkdays && isMakeupWorkday(now);

  const isFridayNight = day === 5;
  const isSaturdayNight = day === 6;
  const isSundayNight = day === 0;

  let primary = SCENE.ORDINARY;
  if (isHolidayLastNight) primary = SCENE.HOLIDAY_LAST_NIGHT;
  else if (isHolidayEve) primary = SCENE.HOLIDAY_EVE;
  else if (isHolidayOngoing) primary = SCENE.HOLIDAY;
  else if (isFridayNight) primary = SCENE.FRIDAY_NIGHT;
  else if (isSaturdayNight) primary = SCENE.SATURDAY_NIGHT;
  else if (isSundayNight) primary = SCENE.SUNDAY_NIGHT;
  else if (isMakeup) primary = SCENE.MAKEUP_WORKDAY_NIGHT;

  const tags = [primary];
  if (isWeekend(now)) tags.push("weekend");
  if (isMakeup) tags.push("makeup-workday");
  if (holidayToday) tags.push(`holiday:${holidayToday.name}`);
  if (isHolidayEve) tags.push(`holiday-eve:${holidayTomorrow.name}`);
  if (day === 5 || day === 6) tags.push("can-sleep-in");

  return {
    at: now.toISOString(),
    dateKey: dateKey(now),
    hour: now.getHours(),
    minute: now.getMinutes(),
    weekday: day,
    weekdayName: weekdayName(now),
    isWeekend: isWeekend(now),
    timeBucket: timeBucketOf(now),
    timeBucketLabel: TIME_BUCKET_LABELS[timeBucketOf(now)],

    holidayToday: holidayToday?.name ?? null,
    holidayTomorrow: holidayTomorrow?.name ?? null,
    holidayYesterday: holidayYesterday?.name ?? null,

    isHolidayEve,
    isHolidayLastNight,
    isHolidayOngoing,
    isMakeupWorkday: isMakeup,

    isFridayNight,
    isSaturdayNight,
    isSundayNight,

    scene: primary,
    sceneLabel: SCENE_LABELS[primary],
    tags,
  };
}

/**
 * 把场景压成一句给 AI 的中文描述，作为提示词的事实依据。
 * 刻意只提供结构化事实，不提供自由文本，以降低模型编造日期与数据的空间。
 */
export function describeScene(scene) {
  const parts = [`现在是 ${scene.dateKey} ${scene.weekdayName} ${String(scene.hour).padStart(2, "0")}:${String(scene.minute).padStart(2, "0")}`];
  parts.push(`场景类型：${scene.sceneLabel}`);
  parts.push(`时段：${scene.timeBucketLabel}`);
  if (scene.holidayToday) parts.push(`今天是${scene.holidayToday}假期中`);
  if (scene.holidayTomorrow) parts.push(`明天是${scene.holidayTomorrow}假期第一天`);
  if (scene.isHolidayLastNight) parts.push(`今天是${scene.holidayToday}假期的最后一天，明天要恢复正常作息`);
  if (scene.isMakeupWorkday) parts.push("今天为法定调休上班日");
  return parts.join("；");
}
