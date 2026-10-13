/**
 * 熄灯早睡 · AI 例外裁定测试
 *
 * 覆盖两件事：
 *  1. parseExceptionDecision 的**容错**：模型返回 JSON 是不可靠的，
 *     而"解析失败"绝不能等于"放行"；
 *  2. 引擎侧的例外：消耗额度、只延后结束时间、跨时段自动失效。
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  EXCEPTION_MAX_MINUTES,
  createEngine,
  createMemoryStorage,
  createQuotaStore,
  createSettingsStore,
  parseExceptionDecision,
} from "../packages/core/src/index.js";

const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi, 0, 0);

describe("parseExceptionDecision · 模型输出的容错", () => {
  test("标准 JSON", () => {
    const r = parseExceptionDecision('{"understood":"今晚要加班","grant":true,"minutes":45,"reason":"一次性例外"}');
    assert.equal(r.grant, true);
    assert.equal(r.minutes, 45);
    assert.equal(r.understood, "今晚要加班");
    assert.equal(r.parsed, true);
  });

  test("被代码块包裹也能解析", () => {
    const raw = "好的：\n```json\n" + '{"grant":true,"minutes":30,"reason":"赶工"}' + "\n```";
    const r = parseExceptionDecision(raw);
    assert.equal(r.grant, true);
    assert.equal(r.minutes, 30);
  });

  test("前后有解释文字时抠出 JSON", () => {
    const r = parseExceptionDecision('我的判断是 {"grant":false,"minutes":0,"reason":"看起来只是想多玩会儿"} 以上。');
    assert.equal(r.grant, false);
    assert.equal(r.minutes, 0);
  });

  test("minutes 超过硬上限会被夹住", () => {
    const r = parseExceptionDecision('{"grant":true,"minutes":9999,"reason":"随便放"}');
    assert.equal(r.minutes, EXCEPTION_MAX_MINUTES);
  });

  test("负数与非法值归零", () => {
    assert.equal(parseExceptionDecision('{"grant":true,"minutes":-30}').minutes, 0);
    assert.equal(parseExceptionDecision('{"grant":true,"minutes":"abc"}').minutes, 0);
  });

  test("拒绝时 minutes 强制为 0", () => {
    const r = parseExceptionDecision('{"grant":false,"minutes":60,"reason":"不允许"}');
    assert.equal(r.grant, false);
    assert.equal(r.minutes, 0, "拒绝却带着时长，会让人误以为放行了");
  });

  // 这一条是整个设计的底线
  test("无法解析时一律拒绝放行（解析失败 ≠ 放行）", () => {
    for (const bad of ["", "我不知道", "当然可以！", '{"grant":', null, undefined, "{}"]) {
      const r = parseExceptionDecision(bad);
      assert.equal(r.grant, false, "输入 " + JSON.stringify(bad) + " 不应被放行");
      assert.equal(r.minutes, 0);
    }
  });
});

describe("engine · 今晚例外", () => {
  function makeEngine(currentTime) {
    const storage = createMemoryStorage();
    const settingsStore = createSettingsStore({ storage });
    settingsStore.update({
      plan: { enabled: true, sundayAsWeekday: true, windows: { weekday: { start: "23:00", end: "07:00" }, weekend: { start: "23:00", end: "07:00" } } },
      emergency: { quotaTotal: 2 },
    });
    const quotaStore = createQuotaStore({ storage });
    const engine = createEngine({ settingsStore, quotaStore, now: () => currentTime });
    return { engine, quotaStore, settingsStore };
  }

  test("放宽会消耗一次额度，并把结束时间推后", () => {
    const clock = at(2026, 10, 12, 23, 30);
    const { engine, quotaStore } = makeEngine(clock);

    const before = engine.snapshot();
    assert.equal(before.phase, "active");
    const beforeRemaining = before.remainingMs;

    const granted = engine.grantException({ minutes: 45, reason: "加班", understood: "今晚要加班" });
    assert.equal(granted.ok, true);
    assert.equal(granted.minutes, 45);
    assert.equal(quotaStore.remaining(clock), 1, "例外必须扣一次额度");

    const after = engine.snapshot();
    assert.equal(after.remainingMs, beforeRemaining + 45 * 60_000);
    assert.equal(after.window.extendedByMs, 45 * 60_000);
    assert.equal(after.phase, "active", "放宽不应改变相位");
  });

  test("额度用完时不能放宽", () => {
    const clock = at(2026, 10, 12, 23, 30);
    const { engine } = makeEngine(clock);
    assert.equal(engine.grantException({ minutes: 30 }).ok, true);
    assert.equal(engine.grantException({ minutes: 30 }).ok, true);
    const third = engine.grantException({ minutes: 30 });
    assert.equal(third.ok, false);
    assert.equal(third.reason, "quota-exhausted");
  });

  test("不在熄灯时段时不能放宽", () => {
    const clock = at(2026, 10, 12, 15, 0);
    const { engine } = makeEngine(clock);
    const r = engine.grantException({ minutes: 30 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not-active");
  });

  test("minutes 为 0 时不消耗额度、不记例外", () => {
    const clock = at(2026, 10, 12, 23, 30);
    const { engine, quotaStore } = makeEngine(clock);
    const r = engine.grantException({ minutes: 0 });
    assert.equal(r.ok, false);
    assert.equal(quotaStore.remaining(clock), 2, "没放宽就不该扣额度");
    assert.equal(engine.exception, null);
  });

  test("超过上限会被夹住", () => {
    const clock = at(2026, 10, 12, 23, 30);
    const { engine } = makeEngine(clock);
    const r = engine.grantException({ minutes: 9999 });
    assert.equal(r.minutes, EXCEPTION_MAX_MINUTES);
  });

  test("跨到下一个时段后例外自动失效", () => {
    const clock = at(2026, 10, 12, 23, 30);
    const { engine } = makeEngine(clock);
    engine.grantException({ minutes: 60 });
    assert.notEqual(engine.exception, null);
    engine.rearm();
    assert.equal(engine.exception, null);
    assert.equal(engine.snapshot().exception, null);
  });
});
