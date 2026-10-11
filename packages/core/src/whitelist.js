/**
 * 熄灯早睡 · 白名单可用时长预算（PRD 2.2.3）
 *
 * PRD 的三条规则在这里落地：
 *  1. "所有白名单应用共用总可用时长" → 单一预算池，与具体应用无关；
 *  2. "总时长耗尽后……当日无法再使用任何白名单应用" → 按"计费周期"重置；
 *  3. 系统电话/短信"无时长限制" → 由 `countsAgainstQuota: false` 标记，压根不进这个池子。
 *
 * ⚠️ 关于"当日"的语义澄清（这是 PRD 中一处真实的自相矛盾）
 * ---------------------------------------------------------------
 * PRD 2.2.3 说耗尽后"**当日**无法再使用"，字面理解是按日历日、0 点重置。
 * 但熄灯时段默认是 23:00 → 次日 07:00，**横跨午夜**。若真的在 0 点重置，
 * 用户只要在 23:50 用掉 30 分钟、0:10 再拿 30 分钟，就能在同一次熄灯里用掉双倍额度。
 * 这显然不是产品意图。
 *
 * 因此本模块把"计费周期"抽象为**由调用方注入的 periodKey**：
 *  - 默认实现 `dateKey`：按日历日重置，严格贴合 PRD 字面语义；
 *  - 应用层实际传入**当前熄灯时段的开始日**（`window.startKey`）：
 *    这样一次熄灯（哪怕跨过午夜）共用一个额度池，下一次熄灯开始时自然重置。
 *
 * 两种行为都有测试覆盖，切换只需换一个 `getPeriodKey`。详见 docs/DECISIONS.md。
 */

import { dateKey } from "./time.js";

/**
 * @param {{
 *   storage: object,
 *   key?: string,
 *   getTotalMinutes?: () => number,
 *   getPeriodKey?: (at: Date) => string,
 *   now?: () => Date
 * }} options
 */
export function createWhitelistBudget({
  storage,
  key = "xideng.whitelist.usage.v1",
  getTotalMinutes = () => 30,
  getPeriodKey = (at) => dateKey(at),
  now = () => new Date(),
}) {
  let state = { periodKey: null, usedMs: 0 };

  function load() {
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? "null");
      if (parsed && typeof parsed === "object") {
        state.periodKey = typeof parsed.periodKey === "string" ? parsed.periodKey : null;
        state.usedMs = Number.isFinite(parsed.usedMs) ? Math.max(0, parsed.usedMs) : 0;
      }
    } catch {
      // 数据损坏 → 视为本周期尚未使用，避免用户被永久锁死
      state = { periodKey: null, usedMs: 0 };
    }
  }

  function persist() {
    try {
      storage.setItem(key, JSON.stringify(state));
    } catch {
      /* 存储不可用时退化为会话内有效 */
    }
  }

  /** 周期切换则清零。返回是否发生了重置。 */
  function sync(at = now()) {
    const current = String(getPeriodKey(at));
    if (state.periodKey !== current) {
      state = { periodKey: current, usedMs: 0 };
      persist();
      return true;
    }
    return false;
  }

  load();
  if (state.periodKey === null) persist();

  function totalMs() {
    return Math.max(0, Number(getTotalMinutes()) || 0) * 60_000;
  }

  return {
    sync,

    usedMs(at = now()) {
      sync(at);
      return state.usedMs;
    },

    remainingMs(at = now()) {
      sync(at);
      return Math.max(0, totalMs() - state.usedMs);
    },

    isExhausted(at = now()) {
      return this.remainingMs(at) <= 0;
    },

    /**
     * 扣减使用时长。
     * @param {number} ms
     * @returns {{ok: boolean, remainingMs: number, exhausted: boolean}}
     */
    charge(ms, at = now()) {
      sync(at);
      const delta = Number(ms);
      if (Number.isFinite(delta) && delta > 0) {
        state.usedMs = Math.min(totalMs(), state.usedMs + delta);
        persist();
      }
      const remaining = Math.max(0, totalMs() - state.usedMs);
      return { ok: remaining > 0, remainingMs: remaining, exhausted: remaining <= 0 };
    },

    snapshot(at = now()) {
      sync(at);
      const total = totalMs();
      const remaining = Math.max(0, total - state.usedMs);
      return {
        periodKey: state.periodKey,
        totalMs: total,
        usedMs: state.usedMs,
        remainingMs: remaining,
        exhausted: remaining <= 0,
      };
    },

    /** 调试与测试用：清空本周期用量 */
    reset(at = now()) {
      state = { periodKey: String(getPeriodKey(at)), usedMs: 0 };
      persist();
    },
  };
}
