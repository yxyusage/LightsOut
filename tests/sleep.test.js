/**
 * 熄灯早睡 · 每日睡眠记录测试（"本周坚持回顾"数据源，PRD 增强 #5）
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { createMemoryStorage, createSleepRecords } from "../packages/core/src/index.js";

const at = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute, 0, 0);

describe("sleepRecords · 每日睡眠记录", () => {
  test("初始状态：无任何记录", () => {
    const records = createSleepRecords({ storage: createMemoryStorage() });
    assert.deepEqual(records.day("2026-10-12"), { entered: false, dismissed: false, dismissCount: 0 });
  });

  test("记录进入熄灯（同一时段重复记录不会翻倍）", () => {
    const records = createSleepRecords({ storage: createMemoryStorage() });
    records.record("2026-10-12", { entered: true });
    records.record("2026-10-12", { entered: true });
    const day = records.day("2026-10-12");
    assert.equal(day.entered, true);
    assert.equal(day.dismissed, false);
    assert.equal(day.dismissCount, 0);
  });

  test("记录紧急解除会累计次数", () => {
    const records = createSleepRecords({ storage: createMemoryStorage() });
    records.record("2026-10-12", { entered: true });
    records.record("2026-10-12", { dismissed: true });
    records.record("2026-10-12", { dismissed: true });
    const day = records.day("2026-10-12");
    assert.equal(day.dismissed, true);
    assert.equal(day.dismissCount, 2);
  });

  test("week 返回自然周（周一 00:00 起）7 天", () => {
    const records = createSleepRecords({ storage: createMemoryStorage() });
    // 2026-10-14 是周三
    records.record("2026-10-12", { entered: true }); // 周一
    records.record("2026-10-14", { entered: true, dismissed: true }); // 周三

    const days = records.week(at(2026, 10, 14, 12, 0));
    assert.equal(days.length, 7);
    assert.equal(days[0].dateKey, "2026-10-12"); // 周一
    assert.equal(days[0].weekdayLabel, "一");
    assert.equal(days[0].entered, true);
    assert.equal(days[0].dismissed, false);

    assert.equal(days[2].dateKey, "2026-10-14");
    assert.equal(days[2].entered, true);
    assert.equal(days[2].dismissed, true);
    assert.equal(days[2].dismissCount, 1);

    assert.equal(days[6].dateKey, "2026-10-18"); // 周日
    assert.equal(days[6].entered, false);
  });

  test("week 支持注入每日白名单用量回调", () => {
    const records = createSleepRecords({ storage: createMemoryStorage() });
    const days = records.week(at(2026, 10, 12, 12, 0), {
      whitelistMsFor: (day) => (day.getDate() === 12 ? 60_000 : 0),
    });
    assert.equal(days[0].whitelistMs, 60_000);
    assert.equal(days[1].whitelistMs, 0);
  });

  test("reset 清空全部记录", () => {
    const storage = createMemoryStorage();
    const records = createSleepRecords({ storage });
    records.record("2026-10-12", { entered: true });
    records.reset();
    assert.equal(records.day("2026-10-12").entered, false);
  });

  test("持久化：重新实例化后数据仍在", () => {
    const storage = createMemoryStorage();
    const first = createSleepRecords({ storage });
    first.record("2026-10-12", { entered: true });
    const second = createSleepRecords({ storage });
    assert.equal(second.day("2026-10-12").entered, true);
  });
});
