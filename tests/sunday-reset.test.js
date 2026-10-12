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
  hashPassword,
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

  test("申请重置期间：密码错误仍被拒，密码正确则解除并撤销申请", async () => {
    // 回归：早先把 pending 检查放在密码校验**之前**，导致误点「忘记密码」的用户
    // 即使密码记得清清楚楚也要干等 24 小时，而且没有任何取消入口。
    // 正确行为是：先验密码，验过了就把重置申请撤掉。
    const settingsStore = createSettingsStore({ storage: createMemoryStorage() });
    const passwordHash = await hashPassword("1234");
    settingsStore.update({
      plan: { enabled: true, sundayAsWeekday: true, windows: { weekday: { start: "22:00", end: "07:00" }, weekend: { start: "01:00", end: "07:00" } } },
      emergency: { passwordHash, quotaTotal: 2 },
    });
    const quotaStore = createQuotaStore({ storage: settingsStore.storage });
    // 2026-10-12 是周一，22:00–07:00 时段生效
    const engine = createEngine({ settingsStore, quotaStore, now: () => at(2026, 10, 12, 23, 30) });

    const info = engine.requestPasswordReset();
    assert.equal(info.pending, true);
    assert.equal(info.remainingMs, PASSWORD_RESET_COOLDOWN_MS);

    // 密码错误 → 被拒，且申请仍然保留（不能靠乱试密码把申请刷掉）
    const wrong = await engine.emergencyUnlock("0000");
    assert.equal(wrong.ok, false);
    assert.equal(wrong.reason, "bad-password");
    assert.equal(engine.passwordResetInfo().pending, true);

    // 密码正确 → 解除成功，并顺带撤销重置申请
    const right = await engine.emergencyUnlock("1234");
    assert.equal(right.ok, true);
    assert.equal(engine.passwordResetInfo().pending, false);
  });

  test("冷却期内重复申请不重置计时", () => {
    const { settingsStore, quotaStore, engine } = makeEngine();
    settingsStore.update({ plan: { enabled: false } });
    engine.requestPasswordReset();
    const again = engine.requestPasswordReset();
    assert.equal(again.remainingMs, PASSWORD_RESET_COOLDOWN_MS);
  });

  test("冷却到期后只清空密码，不碰每周额度（回归：额度曾被刷满）", () => {
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
    // 关键断言：额度**没有**被刷回去。
    // 早先 settlePasswordReset 顺带调了 quotaStore.reset，等于每 24 小时白送 2 次解除，
    // 把 PRD 2.1.3 的「每周 2 次」从 2 次/周放大到约 14 次/周，机制被架空。
    assert.equal(quotaStore.remaining(at(2026, 10, 12, 23, 30)), 1);
  });

  test("正常快照包含 passwordReset 状态", () => {
    const { settingsStore, engine } = makeEngine();
    settingsStore.update({ plan: { enabled: false } });
    engine.requestPasswordReset();
    const snapshot = engine.snapshot();
    assert.equal(snapshot.passwordReset.pending, true);
  });
});
