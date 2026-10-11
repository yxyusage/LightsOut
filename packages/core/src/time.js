/**
 * 熄灯早睡 · 时间与日期基础工具
 *
 * 设计约定：本文件所有函数都是纯函数，**从不读取系统当前时间**。
 * 当前时间一律由调用方（引擎 / UI / 测试）注入，这样熄灯逻辑才能在单元测试里
 * 被完整地"穿越时间"验证，也便于桌面端与 Android 端复用同一套判定。
 */

export const MS_MINUTE = 60_000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;
export const MINUTES_PER_DAY = 1440;

/** 与 JavaScript `Date#getDay()` 对齐：0 = 周日 … 6 = 周六 */
export const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 两位补零 */
export function pad2(value) {
  return String(value).padStart(2, "0");
}

/**
 * `"23:00"` → `1380`（自当日 00:00 起的分钟数）。
 * @throws {RangeError} 格式非法或超出取值范围时抛出，避免脏数据静默进入熄灯判定。
 */
export function toMinutes(hhmm) {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!matched) throw new RangeError(`时间格式非法，应为 HH:MM，收到：${hhmm}`);
  const hours = Number(matched[1]);
  const minutes = Number(matched[2]);
  if (hours > 23 || minutes > 59) throw new RangeError(`时间超出范围：${hhmm}`);
  return hours * 60 + minutes;
}

/** `1380` → `"23:00"`，自动按一天取模 */
export function fromMinutes(totalMinutes) {
  const normalized = ((Math.trunc(totalMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
}

/** 浅拷贝日期，避免调用方共享可变引用 */
export function cloneDate(date) {
  return new Date(date.getTime());
}

/** 当日 00:00:00.000（本地时区） */
export function startOfDay(date) {
  const result = new Date(date.getTime());
  result.setHours(0, 0, 0, 0);
  return result;
}

/** 当日 23:59:59.999（本地时区） */
export function endOfDay(date) {
  const result = startOfDay(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

/** 按"日历日"偏移，跨夏令时时仍稳定落在同一天 */
export function addDays(date, days) {
  const result = startOfDay(date);
  result.setDate(result.getDate() + Math.trunc(days));
  return result;
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + Math.trunc(minutes) * MS_MINUTE);
}

/** `2026-01-01`（本地时区日历日，不含时间部分） */
export function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** `"2026-01-01"` → 本地时区当日 00:00 的 Date */
export function parseDateKey(key) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? "").trim());
  if (!matched) throw new RangeError(`日期格式非法，应为 YYYY-MM-DD，收到：${key}`);
  return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), 0, 0, 0, 0);
}

export function isSameDay(a, b) {
  return dateKey(a) === dateKey(b);
}

export function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function weekdayName(date) {
  return WEEKDAY_NAMES[date.getDay()];
}

/** 相隔的日历天数（b - a），忽略时分秒 */
export function daysBetween(a, b) {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / MS_DAY);
}

/**
 * `"23:04"`；`{ seconds: true }` 时输出 `"23:04:15"`。
 * 黑屏界面每帧都会调用，因此刻意不分配多余对象。
 */
export function formatClock(date, options = {}) {
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return options.seconds ? `${clock}:${pad2(date.getSeconds())}` : clock;
}

/**
 * 把毫秒时长渲染成中文口语表达，用于"距离本次熄灯结束"。
 * 例：`6h23m` → `"6 小时 23 分"`；`23m12s` → `"23 分 12 秒"`；`<60s` → `"不足 1 分钟"`
 */
export function formatDurationCN(ms) {
  if (!Number.isFinite(ms)) return "--";
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  if (minutes > 0) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  return "不足 1 分钟";
}

/**
 * 倒计时专用：始终带秒，且不足 1 分钟时显示秒数（预告弹窗需要精确读秒）。
 * 例：`754000` → `"12 分 34 秒"`；`45000` → `"45 秒"`
 */
export function formatCountdownCN(ms) {
  if (!Number.isFinite(ms)) return "--";
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

/** 一天中的时段分区，供 AI 文案与本地文案挑选合适的语气 */
export function timeBucketOf(date) {
  const hour = date.getHours();
  if (hour >= 22 || hour < 0) return "late";       // 22:00 - 23:59 刚躺下
  if (hour < 3) return "midnight";                  // 00:00 - 02:59 深夜
  if (hour < 5) return "smallHours";                // 03:00 - 04:59 后半夜
  if (hour < 7) return "dawn";                      // 05:00 - 06:59 天将亮
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export const TIME_BUCKET_LABELS = {
  late: "刚躺下",
  midnight: "深夜",
  smallHours: "后半夜",
  dawn: "天将亮",
  morning: "上午",
  afternoon: "下午",
  evening: "傍晚",
};
