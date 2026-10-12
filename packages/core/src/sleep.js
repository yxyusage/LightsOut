/**
 * 熄灯早睡 · 每日睡眠记录（"本周坚持回顾"的数据源）
 *
 * 记录每一天的熄灯行为：
 *  - entered：当天是否进入了熄灯时段（真正躺下开始被接管）
 *  - dismissed：当天是否紧急解除过
 *  - dismissCount：当天解除次数
 *
 * 存储为 `{ [YYYY-MM-DD]: { entered, dismissed, dismissCount } }`，
 * 只落在本机（与设置同一 storage），绝不外发。
 */

import { addDays, dateKey, startOfDay } from "./time.js";

export const SLEEP_RECORDS_KEY = "xideng.sleepRecords";

export function createSleepRecords({ storage, key = SLEEP_RECORDS_KEY }) {
  let state = {};

  function load() {
    try {
      const raw = storage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") state = parsed;
    } catch {
      state = {};
    }
  }

  function persist() {
    try {
      storage.setItem(key, JSON.stringify(state));
    } catch {
      /* 存储不可用时退化为本次会话内有效 */
    }
  }

  load();

  return {
    /**
     * 合并记录一天的行为。
     * @param {string} dateKeyValue `YYYY-MM-DD`
     * @param {{entered?: boolean, dismissed?: boolean}} patch
     */
    record(dateKeyValue, patch) {
      const current = state[dateKeyValue] ?? { entered: false, dismissed: false, dismissCount: 0 };
      const next = { ...current, ...patch };
      // 每次"紧急解除"都计一次（调用方只在解除成功时上报，不会虚增）
      if (patch.dismissed) next.dismissCount = (current.dismissCount ?? 0) + 1;
      state[dateKeyValue] = next;
      persist();
      return next;
    },

    /** 单日状态（无记录时返回全 false 的占位）。 */
    day(dateKeyValue) {
      return state[dateKeyValue] ?? { entered: false, dismissed: false, dismissCount: 0 };
    },

    /**
     * 本周（自然周，周一 00:00 起）7 天的状态数组。
     * @param {Date} now
     * @param {{whitelistMsFor?: (day: Date) => number}} [options] 每日白名单用量回调（可选）
     */
    week(now, { whitelistMsFor } = {}) {
      const day = startOfDay(now);
      const offsetFromMonday = (day.getDay() + 6) % 7; // 周一 → 0，周日 → 6
      const monday = addDays(day, -offsetFromMonday);
      const weekdayNames = ["日", "一", "二", "三", "四", "五", "六"];

      const days = [];
      for (let index = 0; index < 7; index += 1) {
        const date = addDays(monday, index);
        const key = dateKey(date);
        const record = state[key] ?? {};
        days.push({
          dateKey: key,
          weekday: date.getDay(),
          weekdayLabel: weekdayNames[date.getDay()],
          entered: Boolean(record.entered),
          dismissed: Boolean(record.dismissed),
          dismissCount: Number(record.dismissCount ?? 0),
          whitelistMs: whitelistMsFor ? Math.max(0, whitelistMsFor(date)) : 0,
        });
      }
      return days;
    },

    /** 清除全部睡眠记录（"清除本地数据"时调用）。 */
    reset() {
      state = {};
      persist();
    },
  };
}
