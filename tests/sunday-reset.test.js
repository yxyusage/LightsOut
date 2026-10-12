/**
 * 熄灯早睡 · 新增能力测试：
 *  - 周日晚按工作日执行（PRD 讨论结论 B，默认开）
 *  - 忘记密码 24 小时重置冷却（PRD 增强 #4）
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  createEngine,
  createMemoryStorage,
  createQuotaStore,
  createSettingsStore,
  dayTypeOf,
  PASSWORD_RESET_COOLDOWN_MS,
  phaseAt,
} from "../packages/core/src/index.js";

const at = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute, 0, 0);

/** 基础计划：工作日 22:00–07:00，周末 01:00–07:00（周末开始明显更晚） */
function makePlan() {
  return {
    enabled: true,
    warnMinutes: 15,
    sundayAsWeekday: true,
    windows: {
      weekday: { start: "22:00", end: "07:00" },
      weekend: { start: "01:00", end: "07:00" },
    },
  };
}

describe("schedule · 周日晚按工作日执行", () => {
  test("周日默认按工作日执行（dayTypeOf）", () => {
    // 2026-10-11 是周日
    assert.equal(dayTypeOf(at(2026, 10, 11, 12, 0), {}), "weekday");
  });

  test("关闭 sundayAsWeekday 后周日回退为周末", () => {
    assert.equal(dayTypeOf(at(2026, 10, 11, 12, 0), { sundayAsWeekday: false }), "weekend");
  });

  test("周六始终按周末执行", () => {
    // 2026-10-17 是普通周六（非调休）
    assert.equal(dayTypeOf(at(2026, 10, 17, 12, 0), {}), "weekend");
    assert.equal(dayTypeOf(at(2026, 10, 17, 12, 0), { sundayAsWeekday: false }), "weekend");
  });

  test("周日晚 22:30 开启的是工作日时段（保护生效）", () => {
    const active = phaseAt(makePlan(), at(2026, 10, 11, 22, 30), {
      sundayAsWeekday: true,
    });
    assert.equal(active.phase, "active");
    assert.equal(active.window.dayType, "weekday");
  });

  test("关闭开关后，周日晚 22:30 无工作日时段保护，落到 01:00 周末时段", () => {
    const plan = { ...makePlan(), sundayAsWeekday: false };
    const active = phaseAt(plan, at(2026, 10, 11, 22, 30), {
      sundayAsWeekday: false,
    });
    assert.equal(active.phase, "idle");
  });
});

describe("engine · 忘记密码 24 小时重置冷却", () => {
  function makeEngine() {
    const settingsStore = createSettingsStore({ storage: createMemoryStorage() });
    settingsStore.update({ plan: { enabled: false }, emergency: { passwordHash: "deadbeef" } });
    const quotaStore = createQuotaStore({ storage: settingsStore.storage });
    const engine = createEngine({
      settingsStore,
      quotaStore,
      now: () => at(2026, 10, 12, 23, 30),
    });
    return { settingsStore, quotaStore, engine };
  }

  test("申请重置后进入冷却，期间无法紧急解除", async () => {
    const { settingsStore, quotaStore, engine } = makeEngine();
    settingsStore.update({ plan: { enabled: true }, emergency: { quotaTotal: 2 } });
    // 2026-10-12 是周一，22:00–07:00 时段生效
    const info = engine.requestPasswordReset();
    assert.equal(info.pending, true);
    assert.equal(info.remainingMs, PASSWORD_RESET_COOLDOWN_MS);

    const result = await engine.emergencyUnlock("wrong");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "reset-pending");
  });

  test("冷却期内重复申请不重置计时", () => {
    const { settingsStore, quotaStore, engine } = makeEngine();
    settingsStore.update({ plan: { enabled: false } });
    engine.requestPasswordReset();
    const again = engine.requestPasswordReset();
    assert.equal(again.remainingMs, PASSWORD_RESET_COOLDOWN_MS);
  });

  test("冷却到期后自动清空密码并重置本周额度", () => {
    const { settingsStore, quotaStore, engine } = makeEngine();
    settingsStore.update({ plan: { enabled: false } });

    // 先消耗一次额度
    quotaStore.consume(at(2026, 10, 12, 10, 0));
    assert.equal(quotaStore.remaining(at(2026, 10, 12, 10, 0)), 1);

    engine.requestPasswordReset();
    // 伪造 24 小时后的时钟：engine 的 now 固定为 23:30，这里直接推进 settings 时间戳语义
    // 通过直接改写 settings.emergency.passwordResetAt 模拟时间流逝
    settingsStore.update({
      emergency: { passwordResetAt: at(2026, 10, 11, 23, 30).getTime() },
    });

    const info = engine.passwordResetInfo();
    assert.equal(info.pending, false);
    assert.equal(settingsStore.value.emergency.passwordHash, "");
    assert.equal(settingsStore.value.emergency.passwordResetAt, null);
    // 本周额度已被重置回满
    assert.equal(quotaStore.remaining(at(2026, 10, 12, 23, 30)), 2);
  });

  test("正常快照包含 passwordReset 状态", () => {
    const { settingsStore, engine } = makeEngine();
    settingsStore.update({ plan: { enabled: false } });
    engine.requestPasswordReset();
    const snapshot = engine.snapshot();
    assert.equal(snapshot.passwordReset.pending, true);
  });
});
