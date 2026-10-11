/**
 * 熄灯早睡 · 白名单可用时长预算测试（PRD 2.2.3）
 *
 * 这块逻辑的边界条件最多，且 PRD 的"当日"存在真实的语义歧义，
 * 因此两种计费周期都单独验证：日历日（PRD 字面）与熄灯时段（产品意图）。
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { createMemoryStorage, createWhitelistBudget, dateKey } from "../packages/core/src/index.js";

const at = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute, 0, 0);
const totalMinutes = () => 30;

/** 按日历日计费的预算（PRD 2.2.3 字面语义） */
const byCalendarDay = (overrides = {}) =>
  createWhitelistBudget({ storage: createMemoryStorage(), getTotalMinutes: totalMinutes, ...overrides });

/**
 * 按熄灯时段计费的预算（应用层实际采用的策略）。
 * 这里用一个极简的时段模拟：每天 23:00 开启一次时段，时段键为该天日期。
 */
const byLockSession = () => {
  let windowStartKey = null;
  const budget = createWhitelistBudget({
    storage: createMemoryStorage(),
    getTotalMinutes: totalMinutes,
    getPeriodKey: () => windowStartKey,
  });
  return {
    budget,
    /** 模拟"某天 23:00 进入熄灯" */
    startSession: (day) => { windowStartKey = dateKey(day); },
    endSession: () => { windowStartKey = null; },
  };
};

describe("whitelist · 白名单时长预算", () => {
  test("初始剩余等于总时长", () => {
    const snapshot = byCalendarDay().snapshot(at(2026, 9, 1, 23, 30));
    assert.equal(snapshot.totalMs, 30 * 60_000);
    assert.equal(snapshot.remainingMs, 30 * 60_000);
    assert.equal(snapshot.exhausted, false);
  });

  test("多次扣减共享同一个预算池（不区分具体应用）", () => {
    const budget = byCalendarDay();
    const now = at(2026, 9, 1, 23, 30);
    budget.charge(10 * 60_000, now);
    assert.equal(budget.remainingMs(now), 20 * 60_000);
    budget.charge(10 * 60_000, now);
    assert.equal(budget.remainingMs(now), 10 * 60_000);
  });

  test("扣满后进入 exhausted，且用量不会超过总额度", () => {
    const budget = byCalendarDay();
    const now = at(2026, 9, 1, 23, 30);
    budget.charge(25 * 60_000, now);
    const result = budget.charge(25 * 60_000, now);
    assert.equal(result.exhausted, true);
    assert.equal(result.remainingMs, 0);
    assert.equal(budget.usedMs(now), 30 * 60_000, "用量必须被总额度截断");
  });

  test("按日历日计费时，次日 0 点恢复满额（PRD 字面语义）", () => {
    const budget = byCalendarDay();
    budget.charge(30 * 60_000, at(2026, 9, 1, 23, 30));
    assert.equal(budget.isExhausted(at(2026, 9, 1, 23, 59)), true);
    assert.equal(budget.isExhausted(at(2026, 9, 2, 0, 0)), false);
    assert.equal(budget.remainingMs(at(2026, 9, 2, 0, 0)), 30 * 60_000);
  });

  test("按熄灯时段计费时，跨过午夜不会重置（堵住 PRD 的额度漏洞）", () => {
    const session = byLockSession();
    const now = at(2026, 9, 1, 23, 50);
    session.startSession(now);

    session.budget.charge(30 * 60_000, now);
    assert.equal(session.budget.isExhausted(now), true);

    // 跨过午夜，仍在同一次熄灯时段内 → 必须保持耗尽
    const afterMidnight = at(2026, 9, 2, 0, 10);
    assert.equal(
      session.budget.isExhausted(afterMidnight),
      true,
      "同一熄灯时段内跨过午夜不应恢复额度，否则可一夜用掉双倍时长",
    );

    // 次日 23:00 开启新的一次熄灯 → 恢复满额
    const nextNight = at(2026, 9, 2, 23, 0);
    session.startSession(nextNight);
    assert.equal(session.budget.remainingMs(nextNight), 30 * 60_000);
  });

  test("同一次熄灯时段内的多次使用累计扣减", () => {
    const session = byLockSession();
    session.startSession(at(2026, 9, 1, 23, 0));
    session.budget.charge(12 * 60_000, at(2026, 9, 1, 23, 30));
    session.budget.charge(8 * 60_000, at(2026, 9, 2, 2, 0));
    assert.equal(session.budget.remainingMs(at(2026, 9, 2, 3, 0)), 10 * 60_000);
  });

  test("用量跨会话持久化", () => {
    const storage = createMemoryStorage();
    const now = at(2026, 9, 1, 23, 30);
    createWhitelistBudget({ storage, getTotalMinutes: totalMinutes }).charge(12 * 60_000, now);
    const reopened = createWhitelistBudget({ storage, getTotalMinutes: totalMinutes });
    assert.equal(reopened.remainingMs(now), 18 * 60_000);
  });

  test("存储损坏时回退到满额度，而不是把用户锁死", () => {
    const storage = createMemoryStorage({ "xideng.whitelist.usage.v1": "这不是合法 JSON" });
    const budget = createWhitelistBudget({ storage, getTotalMinutes: totalMinutes });
    assert.equal(budget.remainingMs(at(2026, 9, 1)), 30 * 60_000);
  });

  test("总时长被用户调小时，已用时长不会让剩余变成负数", () => {
    let total = 60;
    const budget = createWhitelistBudget({ storage: createMemoryStorage(), getTotalMinutes: () => total });
    const now = at(2026, 9, 1, 23, 30);
    budget.charge(50 * 60_000, now);
    assert.equal(budget.remainingMs(now), 10 * 60_000);
    total = 30; // 用户把上限从 60 分钟改成 30 分钟
    assert.equal(budget.remainingMs(now), 0);
    assert.equal(budget.isExhausted(now), true);
  });

  test("负数或非法扣减量被忽略", () => {
    const budget = byCalendarDay();
    const now = at(2026, 9, 1, 23, 30);
    budget.charge(-5000, now);
    budget.charge(Number.NaN, now);
    assert.equal(budget.remainingMs(now), 30 * 60_000);
  });
});
