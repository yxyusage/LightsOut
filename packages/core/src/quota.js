/**
 * 熄灯早睡 · 每周解除额度
 *
 * PRD 2.1.3：每周提供 2 次紧急解除额度，自然周周一 0 点自动重置。
 * "自然周"按**周一 00:00 为起点**计算，因此直接把"该周周一的日期"当作周键，
 * 键一变即代表跨周，无需额外记录重置时间，也不怕用户改系统时区以外的时间。
 */

import { addDays, dateKey, startOfDay } from "./time.js";
import { WEEKLY_QUOTA_TOTAL } from "./constants.js";

/** 该日期所在自然周的周一 00:00（本地时区） */
export function startOfWeek(date) {
  const day = startOfDay(date);
  const offsetFromMonday = (day.getDay() + 6) % 7; // 周一 → 0，周日 → 6
  return addDays(day, -offsetFromMonday);
}

/** 周键，例如 `"2026-08-31"`，表示 2026-08-31 那一周 */
export function weekKeyOf(date) {
  return dateKey(startOfWeek(date));
}

/**
 * 创建一个周额度存储。
 * @param {{storage: object, key?: string, total?: number}} options
 */
export function createQuotaStore({ storage, key = "quota", total = WEEKLY_QUOTA_TOTAL }) {
  let state = { weekKey: null, used: 0, total };

  function load() {
    try {
      const raw = storage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        state.weekKey = typeof parsed.weekKey === "string" ? parsed.weekKey : null;
        state.used = Number.isFinite(parsed.used) ? Math.max(0, Math.trunc(parsed.used)) : 0;
        if (Number.isFinite(parsed.total)) state.total = Math.max(0, Math.trunc(parsed.total));
      }
    } catch {
      // 数据损坏时静默回退到全新状态，绝不因为存储异常把用户锁死
      state = { weekKey: null, used: 0, total };
    }
  }

  function persist() {
    try {
      storage.setItem(key, JSON.stringify(state));
    } catch {
      /* 存储不可用时退化为本次会话内有效 */
    }
  }

  /** 跨周则清零（PRD 2.1.3 的自然周重置）。返回是否发生了重置。 */
  function sync(now) {
    const currentWeek = weekKeyOf(now);
    if (state.weekKey !== currentWeek) {
      state = { weekKey: currentWeek, used: 0, total: state.total };
      persist();
      return true;
    }
    return false;
  }

  load();
  if (state.weekKey === null) persist();

  return {
    sync,

    /** 剩余次数 */
    remaining(now) {
      sync(now);
      return Math.max(0, state.total - state.used);
    },

    /** 是否还能紧急解除 */
    isAvailable(now) {
      return this.remaining(now) > 0;
    },

    /**
     * 消费一次额度。
     * @returns {{ok: boolean, remaining: number, reason?: string}}
     */
    consume(now) {
      sync(now);
      if (state.total - state.used <= 0) {
        return { ok: false, remaining: 0, reason: "本周解除额度已用完" };
      }
      state.used += 1;
      persist();
      return { ok: true, remaining: Math.max(0, state.total - state.used) };
    },

    /** 完整快照，供"个人中心"展示（PRD 2.1.3） */
    snapshot(now) {
      sync(now);
      return {
        weekKey: state.weekKey,
        total: state.total,
        used: state.used,
        remaining: Math.max(0, state.total - state.used),
        resetAt: null,
      };
    },

    /** 测试与"重置本周额度"调试入口使用 */
    reset(now) {
      state = { weekKey: weekKeyOf(now), used: 0, total: state.total };
      persist();
    },

    setTotal(nextTotal) {
      state.total = Math.max(0, Math.trunc(nextTotal));
      persist();
    },
  };
}
