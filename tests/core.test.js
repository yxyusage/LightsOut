/**
 * 熄灯早睡 · 核心逻辑测试
 *
 * 运行：`npm test`（等价于 `node --test tests/`），无任何第三方依赖。
 *
 * 测试重点刻意放在"容易写错且后果严重"的地方：
 *  - 跨天熄灯时段的区间计算；
 *  - 自然周额度在周一 0 点重置；
 *  - 节假日日期与国务院通知中写明的星期是否一致（防止抄错日期）；
 *  - 紧急解除的校验顺序（密码错不扣额度）。
 */

import assert from "node:assert/strict";
import test, { describe } from "node:test";

import {
  AI_SYSTEM_PROMPT,
  AUDIO_PRESETS,
  COMFORT,
  DEFAULT_SETTINGS,
  EMERGENCY_TAP_WINDOW_MS,
  HAZARDS,
  HOLIDAY_RANGES,
  PHASE,
  SCENE,
  WEEKLY_QUOTA_TOTAL,
  activeWindowAt,
  buildAudioGraph,
  buildMessages,
  buildPlaylist,
  clone,
  createAIClient,
  createClockGuard,
  createEngine,
  createMemoryStorage,
  createQuotaStore,
  createRandom,
  createRotator,
  createSettingsStore,
  createStore,
  createTapCounter,
  createWhitelistBudget,
  dateKey,
  daysBetween,
  dayTypeOf,
  deepMerge,
  detectScene,
  formatCountdownCN,
  formatDurationCN,
  fromMinutes,
  generateNoiseSamples,
  getDateInfo,
  hashPassword,
  holidayContext,
  isHoliday,
  isMakeupWorkday,
  migrateSettings,
  nextWindowAt,
  parseDateKey,
  passwordAdvice,
  phaseAt,
  sanitizeCopy,
  startOfWeek,
  toMinutes,
  validateWindow,
  verifyPassword,
  weekKeyOf,
  windowForDate,
} from "../packages/core/src/index.js";

/** 构造本地时区的日期，避免测试受运行机器时区影响 */
const at = (year, month, day, hour = 0, minute = 0, second = 0) =>
  new Date(year, month - 1, day, hour, minute, second, 0);

// ─────────────────────────────────────────────────────────────
describe("time · 时间基础工具", () => {
  test("toMinutes / fromMinutes 互为逆运算且严格校验", () => {
    assert.equal(toMinutes("00:00"), 0);
    assert.equal(toMinutes("23:00"), 1380);
    assert.equal(toMinutes("7:05"), 425);
    assert.equal(fromMinutes(1380), "23:00");
    assert.equal(fromMinutes(0), "00:00");
    // 跨天取模：25 小时等价于 1 小时
    assert.equal(fromMinutes(1500), "01:00");
    assert.equal(fromMinutes(-60), "23:00");
  });

  test("非法时间必须抛错，不能静默当成 0", () => {
    assert.throws(() => toMinutes("24:00"), RangeError);
    assert.throws(() => toMinutes("23:60"), RangeError);
    assert.throws(() => toMinutes("abc"), RangeError);
    assert.throws(() => toMinutes(""), RangeError);
    assert.throws(() => toMinutes(null), RangeError);
  });

  test("dateKey / parseDateKey 往返一致", () => {
    const day = at(2026, 1, 4);
    assert.equal(dateKey(day), "2026-01-04");
    assert.equal(dateKey(parseDateKey("2026-01-04")), "2026-01-04");
    assert.throws(() => parseDateKey("2026/01/04"), RangeError);
  });

  test("daysBetween 忽略时分秒", () => {
    assert.equal(daysBetween(at(2026, 1, 1, 23, 59), at(2026, 1, 2, 0, 1)), 1);
    assert.equal(daysBetween(at(2026, 1, 1), at(2026, 2, 1)), 31);
    assert.equal(daysBetween(at(2026, 3, 1), at(2026, 2, 28)), -1);
  });

  test("formatDurationCN 按口渴程度分级表达", () => {
    assert.equal(formatDurationCN(6 * 3600_000 + 23 * 60_000), "6 小时 23 分");
    assert.equal(formatDurationCN(3600_000), "1 小时");
    assert.equal(formatDurationCN(23 * 60_000 + 12_000), "23 分 12 秒");
    assert.equal(formatDurationCN(45_000), "不足 1 分钟");
    assert.equal(formatDurationCN(0), "不足 1 分钟");
    // 负数（时钟回拨）不能输出 "-1 小时"
    assert.equal(formatDurationCN(-5000), "不足 1 分钟");
  });

  test("formatCountdownCN 始终带秒", () => {
    assert.equal(formatCountdownCN(45_000), "45 秒");
    assert.equal(formatCountdownCN(754_000), "12 分 34 秒");
  });
});

// ─────────────────────────────────────────────────────────────
describe("holidays · 2026 年数据必须与国务院通知逐字一致", () => {
  // 通知原文用星期描述每个日期，这里反过来验证我们录入的日期确实落在那些星期上。
  // 这是防止"抄错一天"最有效的一道防线。
  const officialWeekdays = [
    ["2026-01-01", 4, "元旦首日 周四"],
    ["2026-01-03", 6, "元旦末日 周六"],
    ["2026-01-04", 0, "元旦调休上班 周日"],
    ["2026-02-15", 0, "春节首日 周日"],
    ["2026-02-23", 1, "春节末日 周一"],
    ["2026-02-14", 6, "春节调休上班 周六"],
    ["2026-02-28", 6, "春节调休上班 周六"],
    ["2026-04-04", 6, "清明首日 周六"],
    ["2026-04-06", 1, "清明末日 周一"],
    ["2026-05-01", 5, "劳动节首日 周五"],
    ["2026-05-05", 2, "劳动节末日 周二"],
    ["2026-05-09", 6, "劳动节调休上班 周六"],
    ["2026-06-19", 5, "端午首日 周五"],
    ["2026-06-21", 0, "端午末日 周日"],
    ["2026-09-25", 5, "中秋首日 周五"],
    ["2026-09-27", 0, "中秋末日 周日"],
    ["2026-10-01", 4, "国庆首日 周四"],
    ["2026-10-07", 3, "国庆末日 周三"],
    ["2026-09-20", 0, "国庆调休上班 周日"],
    ["2026-10-10", 6, "国庆调休上班 周六"],
  ];

  for (const [key, weekday, label] of officialWeekdays) {
    test(`${label}（${key}）`, () => {
      assert.equal(parseDateKey(key).getDay(), weekday, `${key} 应是 ${label}`);
    });
  }

  test("各节日放假天数与通知一致", () => {
    const expected = { 元旦: 3, 春节: 9, 清明节: 3, 劳动节: 5, 端午节: 3, 中秋节: 3, 国庆节: 7 };
    for (const [name, days] of Object.entries(expected)) {
      const range = HOLIDAY_RANGES.find((item) => item.name === name);
      assert.ok(range, `缺少节日数据：${name}`);
      const actual = Math.round((parseDateKey(range.end) - parseDateKey(range.start)) / 86_400_000) + 1;
      assert.equal(actual, days, `${name} 放假天数应为 ${days}`);
    }
  });

  test("调休上班日全部登记为 makeup，且都不是法定假日", () => {
    for (const range of HOLIDAY_RANGES) {
      for (const day of range.makeup) {
        assert.equal(isMakeupWorkday(day), true, `${day} 应登记为调休上班`);
        assert.equal(isHoliday(day), false, `${day} 不应同时是放假`);
      }
    }
  });

  test("假期中间的日子被识别为放假", () => {
    assert.equal(getDateInfo("2026-02-18").name, "春节");
    assert.equal(isHoliday("2026-10-03"), true);
    assert.equal(isHoliday("2026-10-08"), false, "假期结束后第一天不是假日");
  });

  test("holidayContext 能同时看昨天 / 今天 / 明天", () => {
    // 2026-02-14 是调休上班日（不是放假），明天进入春节
    const context = holidayContext(parseDateKey("2026-02-14"));
    assert.equal(context.today.kind, "makeup", "调休上班日应被识别为 makeup 而非 holiday");
    assert.equal(context.tomorrow.name, "春节");
    assert.equal(context.tomorrow.kind, "holiday");
    // 2026-02-23 是春节最后一天，明天恢复上班
    const lastDay = holidayContext(parseDateKey("2026-02-23"));
    assert.equal(lastDay.today.name, "春节");
    assert.equal(lastDay.tomorrow, null);
  });
});

// ─────────────────────────────────────────────────────────────
describe("schedule · 睡眠计划与相位", () => {
  const plan = {
    enabled: true,
    warnMinutes: 15,
    windows: {
      weekday: { start: "23:00", end: "07:00" },
      weekend: { start: "23:00", end: "07:00" },
    },
  };

  test("跨天时段：周五 23:00 的区间结束于周六 07:00", () => {
    const window = windowForDate(plan, at(2026, 9, 4, 23, 0));
    assert.equal(window.crossesMidnight, true);
    assert.equal(dateKey(window.start), "2026-09-04");
    assert.equal(dateKey(window.end), "2026-09-05");
    assert.equal(window.end.getHours(), 7);
    assert.equal(window.durationMs, 8 * 3600_000);
  });

  test("凌晨 02:00 属于前一天开启的时段", () => {
    const active = activeWindowAt(plan, at(2026, 9, 5, 2, 0));
    assert.ok(active, "凌晨 02:00 应处于熄灯中");
    assert.equal(active.startKey, "2026-09-04", "归属的应是周五那一次时段");
  });

  test("相位边界：22:44 尚未预告，22:45 进入预告，23:00 进入熄灯", () => {
    assert.equal(phaseAt(plan, at(2026, 9, 4, 22, 44)).phase, PHASE.IDLE);
    const warning = phaseAt(plan, at(2026, 9, 4, 22, 45));
    assert.equal(warning.phase, PHASE.WARNING);
    assert.equal(warning.remainingMs, 15 * 60_000);
    assert.equal(phaseAt(plan, at(2026, 9, 4, 23, 0)).phase, PHASE.ACTIVE);
  });

  test("熄灯结束后回到 IDLE，并指向下一个时段", () => {
    const after = phaseAt(plan, at(2026, 9, 5, 7, 0));
    assert.equal(after.phase, PHASE.IDLE);
    assert.equal(dateKey(after.window.start), "2026-09-05");
    assert.equal(after.window.start.getHours(), 23);
  });

  test("关闭计划后一律为 OFF", () => {
    const off = phaseAt({ ...plan, enabled: false }, at(2026, 9, 4, 23, 30));
    assert.equal(off.phase, PHASE.OFF);
    assert.equal(off.window, null);
  });

  test("start === end 视为未配置，不产生 24 小时锁定", () => {
    const broken = { enabled: true, windows: { weekday: { start: "23:00", end: "23:00" }, weekend: { start: "23:00", end: "23:00" } } };
    assert.equal(windowForDate(broken, at(2026, 9, 4)), null);
    assert.equal(activeWindowAt(broken, at(2026, 9, 4, 23, 30)), null);
  });

  test("调休上班的周六按工作日时段执行（可关闭该行为）", () => {
    const makeupSaturday = at(2026, 2, 28, 12, 0); // 春节调休上班的周六
    assert.equal(dayTypeOf(makeupSaturday), "weekday");
    assert.equal(dayTypeOf(makeupSaturday, { respectMakeupWorkdays: false }), "weekend");
  });

  test("nextWindowAt 跳过已开始的时段", () => {
    const next = nextWindowAt(plan, at(2026, 9, 4, 23, 30));
    assert.equal(dateKey(next.start), "2026-09-05");
  });

  test("validateWindow 拦住常见错误配置", () => {
    assert.deepEqual(validateWindow({ start: "23:00", end: "07:00" }), []);
    assert.equal(validateWindow({ start: "23:00", end: "23:00" }).length, 1);
    assert.ok(validateWindow({ start: "23:00", end: "23:10" })[0].includes("30 分钟"));
    assert.ok(validateWindow({ start: "abc", end: "07:00" }).length > 0);
  });
});

// ─────────────────────────────────────────────────────────────
describe("scene · 场景识别", () => {
  test("周五晚 / 周六晚 / 周日晚", () => {
    assert.equal(detectScene(at(2026, 9, 4, 23, 30)).scene, SCENE.FRIDAY_NIGHT);
    assert.equal(detectScene(at(2026, 9, 5, 23, 30)).scene, SCENE.SATURDAY_NIGHT);
    assert.equal(detectScene(at(2026, 9, 6, 23, 30)).scene, SCENE.SUNDAY_NIGHT);
    assert.equal(detectScene(at(2026, 9, 7, 23, 30)).scene, SCENE.ORDINARY);
  });

  test("节假日优先级高于星期", () => {
    // 2026-10-02 是周五，但处于国庆假期中
    const scene = detectScene(at(2026, 10, 2, 23, 30));
    assert.equal(scene.scene, SCENE.HOLIDAY);
    assert.equal(scene.holidayToday, "国庆节");
  });

  test("假期前夜与假期最后一晚", () => {
    // 2026-09-24 是周四，明天进入中秋
    const eve = detectScene(at(2026, 9, 24, 23, 30));
    assert.equal(eve.scene, SCENE.HOLIDAY_EVE);
    assert.equal(eve.holidayTomorrow, "中秋节");
    assert.equal(eve.isHolidayEve, true);

    // 2026-09-27 是中秋最后一天
    const last = detectScene(at(2026, 9, 27, 23, 30));
    assert.equal(last.scene, SCENE.HOLIDAY_LAST_NIGHT);
    assert.equal(last.isHolidayLastNight, true);
  });

  test("凌晨场景归属正确的时间分区", () => {
    assert.equal(detectScene(at(2026, 9, 5, 1, 0)).timeBucket, "midnight");
    assert.equal(detectScene(at(2026, 9, 5, 4, 0)).timeBucket, "smallHours");
    assert.equal(detectScene(at(2026, 9, 5, 6, 0)).timeBucket, "dawn");
  });
});

// ─────────────────────────────────────────────────────────────
describe("copy · 文案库与轮播", () => {
  test("每一条危害科普都绑定可核查的来源", () => {
    const sourced = HAZARDS.filter((entry) => entry.source);
    assert.ok(sourced.length >= 5, "至少应有 5 条带来源的危害数据");
    for (const entry of sourced) {
      assert.ok(entry.source, `${entry.id} 缺少 source`);
    }
  });

  test("同一天同一场景的播放顺序稳定（刷新后不会跳变）", () => {
    const scene = detectScene(at(2026, 9, 4, 23, 30));
    const first = buildPlaylist(scene).map((entry) => entry.id);
    const second = buildPlaylist(detectScene(at(2026, 9, 4, 23, 45))).map((entry) => entry.id);
    assert.deepEqual(first, second);
  });

  test("不同日期会得到不同的顺序", () => {
    const a = buildPlaylist(detectScene(at(2026, 9, 4, 23, 30))).map((e) => e.id).join(",");
    const b = buildPlaylist(detectScene(at(2026, 9, 5, 23, 30))).map((e) => e.id).join(",");
    assert.notEqual(a, b);
  });

  test("播放列表包含危害、安抚与场景三类内容", () => {
    const playlist = buildPlaylist(detectScene(at(2026, 9, 4, 23, 30)));
    const kinds = new Set(playlist.map((entry) => entry.kind));
    assert.ok(kinds.has("hazard"));
    assert.ok(kinds.has("comfort"));
    assert.ok(kinds.has("scene"));
  });

  test("关闭危害科普后不再出现 hazard", () => {
    const playlist = buildPlaylist(detectScene(at(2026, 9, 4, 23, 30)), { includeHazards: false });
    assert.equal(playlist.some((entry) => entry.kind === "hazard"), false);
  });

  test("轮播到末尾后从头继续", () => {
    const entries = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const rotator = createRotator({ entries, intervalMs: 1000 });
    assert.equal(rotator.current().id, "a");
    assert.equal(rotator.next().id, "b");
    assert.equal(rotator.next().id, "c");
    assert.equal(rotator.next().id, "a", "应循环回第一条");
    assert.equal(rotator.jumpTo("c").id, "c");
    assert.equal(rotator.jumpTo("不存在").id, "c", "找不到时保持不动");
  });

  test("空列表必须报错，而不是产生 undefined 文案", () => {
    assert.throws(() => createRotator({ entries: [] }), RangeError);
  });

  test("createRandom 是确定性的", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  });

  test("文案库没有重复 id", () => {
    const ids = [...HAZARDS, ...COMFORT].map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, "存在重复的文案 id");
  });
});

// ─────────────────────────────────────────────────────────────
describe("quota · 每周解除额度", () => {
  test("自然周以周一 0 点为界", () => {
    assert.equal(weekKeyOf(at(2026, 8, 31, 0, 0)), "2026-08-31", "周一是本周起点");
    assert.equal(weekKeyOf(at(2026, 8, 31, 23, 59)), "2026-08-31");
    assert.equal(weekKeyOf(at(2026, 9, 6, 23, 59)), "2026-08-31", "周日仍属于本周");
    assert.equal(weekKeyOf(at(2026, 9, 7, 0, 0)), "2026-09-07", "下周一进入新的一周");
    assert.equal(startOfWeek(at(2026, 9, 6, 15, 0)).getDay(), 1, "起点必须是周一");
  });

  test("周日晚用掉的额度，周一 0 点自动恢复", () => {
    const quota = createQuotaStore({ storage: createMemoryStorage(), total: WEEKLY_QUOTA_TOTAL });
    const sundayNight = at(2026, 8, 30, 23, 0);
    const justBeforeMonday = at(2026, 8, 30, 23, 59, 59);
    const mondayMidnight = at(2026, 8, 31, 0, 0, 0);

    assert.equal(quota.remaining(sundayNight), 2);
    assert.equal(quota.consume(sundayNight).ok, true);
    assert.equal(quota.consume(sundayNight).ok, true);
    assert.equal(quota.remaining(justBeforeMonday), 0, "周日末尾额度应已用尽");
    assert.equal(quota.consume(justBeforeMonday).ok, false, "用尽后不能再解除");

    assert.equal(quota.remaining(mondayMidnight), 2, "周一 0 点应重置");
    assert.equal(quota.consume(mondayMidnight).ok, true);
  });

  test("额度用尽时给出明确原因", () => {
    const quota = createQuotaStore({ storage: createMemoryStorage(), total: 1 });
    const now = at(2026, 9, 1, 23, 30);
    assert.equal(quota.consume(now).ok, true);
    const second = quota.consume(now);
    assert.equal(second.ok, false);
    assert.equal(second.remaining, 0);
    assert.match(second.reason, /额度/);
  });

  test("额度状态跨会话持久化", () => {
    const storage = createMemoryStorage();
    const now = at(2026, 9, 1, 23, 30);
    const first = createQuotaStore({ storage, total: 2 });
    first.consume(now);
    // 模拟重新打开应用
    const reopened = createQuotaStore({ storage, total: 2 });
    assert.equal(reopened.remaining(now), 1);
  });

  test("存储损坏时回退到满额度，绝不把用户锁死", () => {
    const storage = createMemoryStorage({ quota: "{ 这不是合法 JSON" });
    const quota = createQuotaStore({ storage, total: 2 });
    assert.equal(quota.remaining(at(2026, 9, 1)), 2);
  });
});

// ─────────────────────────────────────────────────────────────
describe("settings · 迁移与容错", () => {
  test("空输入得到完整默认值", () => {
    const settings = migrateSettings(undefined);
    assert.equal(settings.plan.windows.weekday.start, "23:00");
    assert.equal(settings.plan.warnMinutes, 15);
    assert.equal(settings.whitelist.totalMinutes, 30);
    assert.equal(settings.version, DEFAULT_SETTINGS.version);
  });

  test("非法字段被夹到合法区间，而不是原样透传", () => {
    const settings = migrateSettings({
      blackout: { brightness: 99 },
      whitelist: { totalMinutes: 9999 },
      ai: { temperature: -5, timeoutMs: 1 },
      plan: { warnMinutes: -1 },
    });
    assert.equal(settings.blackout.brightness, 1);
    assert.equal(settings.whitelist.totalMinutes, 60, "白名单时长上限为 60 分钟");
    assert.equal(settings.ai.temperature, 0);
    assert.equal(settings.ai.timeoutMs, 2000);
    assert.equal(settings.plan.warnMinutes, 0);
  });

  test("系统电话与短信始终在列且不可移除", () => {
    const settings = migrateSettings({ whitelist: { apps: [{ id: "wechat", name: "微信" }] } });
    const phone = settings.whitelist.apps.find((app) => app.id === "sys-phone");
    const sms = settings.whitelist.apps.find((app) => app.id === "sys-sms");
    assert.ok(phone && sms, "系统应用必须被补回");
    assert.equal(phone.removable, false);
    assert.equal(phone.countsAgainstQuota, false, "系统通话不占用白名单时长");
    assert.ok(settings.whitelist.apps.some((app) => app.id === "wechat"));
  });

  test("用户无法通过直接改数据把系统应用标记为可移除", () => {
    const settings = migrateSettings({ whitelist: { apps: [{ id: "sys-phone", name: "电话", removable: true, countsAgainstQuota: true }] } });
    const phone = settings.whitelist.apps.find((app) => app.id === "sys-phone");
    assert.equal(phone.removable, false);
    assert.equal(phone.countsAgainstQuota, false);
  });

  test("resetting 回到默认值", () => {
    const store = createSettingsStore({ storage: createMemoryStorage() });
    store.update({ plan: { warnMinutes: 30 } });
    assert.equal(store.value.plan.warnMinutes, 30);
    store.reset();
    assert.equal(store.value.plan.warnMinutes, 15);
  });

  test("订阅者在更新时被通知", () => {
    const store = createSettingsStore({ storage: createMemoryStorage() });
    let calls = 0;
    const unsubscribe = store.subscribe(() => { calls += 1; });
    store.update({ plan: { warnMinutes: 30 } });
    assert.equal(calls, 1);
    unsubscribe();
    store.update({ plan: { warnMinutes: 10 } });
    assert.equal(calls, 1, "退订后不应再收到通知");
  });

  test("损坏的存储数据不会让应用启动失败", () => {
    const storage = createMemoryStorage({ "xideng.settings.v1": "!!!非法 JSON!!!" });
    const store = createSettingsStore({ storage });
    assert.equal(store.value.plan.windows.weekday.start, "23:00");
  });
});

// ─────────────────────────────────────────────────────────────
describe("storage · 深合并与容错", () => {
  test("深合并递归处理对象，但整体替换数组", () => {
    const base = { a: { b: 1, c: 2 }, list: [1, 2, 3] };
    const merged = deepMerge(base, { a: { c: 9 }, list: [7] });
    assert.deepEqual(merged, { a: { b: 1, c: 9 }, list: [7] });
    assert.deepEqual(base, { a: { b: 1, c: 2 }, list: [1, 2, 3] }, "不得修改原对象");
  });

  test("clone 是深拷贝", () => {
    const source = { nested: { value: 1 }, list: [{ x: 1 }] };
    const copy = clone(source);
    copy.nested.value = 99;
    copy.list[0].x = 99;
    assert.equal(source.nested.value, 1);
    assert.equal(source.list[0].x, 1);
  });

  test("存储抛异常时 createStore 仍可用", () => {
    const broken = {
      getItem() { throw new Error("SecurityError"); },
      setItem() { throw new Error("QuotaExceededError"); },
      removeItem() { throw new Error("SecurityError"); },
    };
    const store = createStore({ storage: broken, key: "k", defaults: { value: 1 } });
    assert.equal(store.read().value, 1);
    assert.equal(store.write({ value: 2 }), false, "写入失败应返回 false 而不是抛错");
  });
});

// ─────────────────────────────────────────────────────────────
describe("password · 紧急解除密码", () => {
  test("正确密码通过，错误密码不通过", async () => {
    const hash = await hashPassword("1234");
    assert.equal(await verifyPassword("1234", hash), true);
    assert.equal(await verifyPassword("1235", hash), false);
    assert.equal(await verifyPassword("", hash), false);
  });

  test("相同密码得到相同摘要（可持久化）", async () => {
    assert.equal(await hashPassword("abcd"), await hashPassword("abcd"));
    assert.notEqual(await hashPassword("abcd"), await hashPassword("abce"));
  });

  test("未设置密码时永远不通过，避免空密码解锁", async () => {
    assert.equal(await verifyPassword("", ""), false);
    assert.equal(await verifyPassword("1234", ""), false);
  });

  test("密码建议", () => {
    assert.deepEqual(passwordAdvice("12"), ["至少 4 位", "纯数字容易误触通过，建议混合字母"]);
    assert.deepEqual(passwordAdvice("abcd1234"), []);
  });
});

// ─────────────────────────────────────────────────────────────
describe("guard · 防绕过守卫", () => {
  test("系统时间被向前拨动时被检出", () => {
    let wall = 1_000_000;
    let mono = 0;
    const jumps = [];
    const guard = createClockGuard({
      now: () => wall,
      monotonic: () => mono,
      toleranceMs: 5000,
      onJump: (event) => jumps.push(event),
    });

    wall += 1000;
    mono += 1000;
    assert.equal(guard.sample(), null, "正常流逝不应触发");

    // 用户把系统时间往前调了 2 小时，试图跳过熄灯时段
    wall += 2 * 3600_000;
    mono += 1000;
    const event = guard.sample();
    assert.ok(event, "应检出时间跳变");
    assert.equal(event.direction, "forward");
    assert.ok(event.drift > 7_000_000);
    assert.equal(jumps.length, 1);
  });

  test("系统时间被向后拨动同样被检出", () => {
    let wall = 5_000_000;
    let mono = 0;
    const guard = createClockGuard({ now: () => wall, monotonic: () => mono, toleranceMs: 5000 });
    wall -= 3600_000;
    mono += 1000;
    assert.equal(guard.sample().direction, "backward");
  });

  test("连续点击计数：够 5 次触发，间隔过久则重新计数", () => {
    let now = 0;
    const triggers = [];
    const counter = createTapCounter({ required: 5, windowMs: EMERGENCY_TAP_WINDOW_MS, now: () => now, onTrigger: (e) => triggers.push(e) });

    assert.equal(counter.tap().progress, 1);
    assert.equal(counter.tap().progress, 2);
    assert.equal(counter.tap().progress, 3);
    assert.equal(counter.tap().progress, 4);

    // 停顿超过时间窗 → 之前的点击作废
    now += EMERGENCY_TAP_WINDOW_MS + 1;
    assert.equal(counter.tap().progress, 1, "超时应重新计数");

    now += 100;
    counter.tap();
    now += 100;
    counter.tap();
    now += 100;
    counter.tap();
    now += 100;
    const fifth = counter.tap();
    assert.equal(fifth.triggered, true);
    assert.equal(triggers.length, 1, "恰好触发一次");
    assert.equal(counter.progress, 0, "触发后计数清零");
  });
});

// ─────────────────────────────────────────────────────────────
describe("audio · 白噪音合成", () => {
  test("五种音色都已定义且 id 唯一", () => {
    assert.equal(AUDIO_PRESETS.length, 5);
    assert.equal(new Set(AUDIO_PRESETS.map((p) => p.id)).size, 5);
    assert.deepEqual(AUDIO_PRESETS.map((p) => p.id), ["rain", "stream", "waves", "campfire", "white"]);
  });

  test("噪声采样长度正确且落在 [-1, 1]", () => {
    for (const type of ["white", "pink", "brown"]) {
      const samples = generateNoiseSamples({ length: 4000, type, random: createRandom(7) });
      assert.equal(samples.length, 4000);
      for (const value of samples) {
        assert.ok(value >= -1 && value <= 1, `${type} 采样越界：${value}`);
      }
    }
  });

  test("白噪声均值接近 0（无直流偏移，否则会有可听的爆音）", () => {
    const samples = generateNoiseSamples({ length: 40_000, type: "white", random: createRandom(11) });
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    assert.ok(Math.abs(mean) < 0.02, `白噪声直流偏移过大：${mean}`);
  });

  test("布朗噪声比白噪声更平滑（相邻样本相关性更高）", () => {
    const autocorrelation = (samples) => {
      let numerator = 0;
      let denominator = 0;
      for (let i = 1; i < samples.length; i += 1) numerator += samples[i] * samples[i - 1];
      for (let i = 0; i < samples.length; i += 1) denominator += samples[i] * samples[i];
      return numerator / denominator;
    };
    const white = generateNoiseSamples({ length: 20_000, type: "white", random: createRandom(3) });
    const brown = generateNoiseSamples({ length: 20_000, type: "brown", random: createRandom(3) });
    assert.ok(autocorrelation(brown) > autocorrelation(white) + 0.5, "布朗噪声应显著更平滑");
  });

  test("长度非法时抛错", () => {
    assert.throws(() => generateNoiseSamples({ length: 0 }), RangeError);
    assert.throws(() => generateNoiseSamples({ length: -5 }), RangeError);
    assert.throws(() => generateNoiseSamples({ length: 1.5 }), RangeError);
  });

  /**
   * 忠实的 AudioContext 假实现。
   *
   * 关键在最后一段：**二次调用 start() 会像真实浏览器一样抛错**。
   * 早先这个假实现把 start() 写成空函数，于是"LFO 在构建阶段被提前启动、
   * start() 又启动一次"这个真实 bug 完全没有被测试覆盖到 ——
   * 线上表现就是雨声 / 溪流声 / 海浪声三个音色全部静音。
   */
  function createFakeAudioContext() {
    const started = [];
    const doubleStarts = [];
    let counter = 0;

    const param = (value) => ({
      value,
      setValueAtTime() {},
      linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {},
      cancelScheduledValues() {},
    });

    const base = (kind) => ({
      __id: kind + "#" + (++counter),
      __kind: kind,
      connect(dest) { return dest; },
      disconnect() {},
    });

    // 只有真正可调度的节点才有 start()，与真实 Web Audio 一致
    const startable = (kind) => Object.assign(base(kind), {
      __startCount: 0,
      start() {
        this.__startCount += 1;
        if (this.__startCount > 1) {
          doubleStarts.push(this.__id);
          throw new Error("cannot call start more than once: " + this.__id);
        }
        started.push(this.__id);
      },
      stop() {},
    });

    return {
      currentTime: 0,
      sampleRate: 8000,
      destination: base("destination"),
      __started: started,
      __doubleStarts: doubleStarts,
      createGain: () => Object.assign(base("gain"), { gain: param(1) }),
      createBuffer: () => ({ copyToChannel() {} }),
      createBiquadFilter: () => Object.assign(base("filter"), { frequency: param(0), Q: param(0), type: "" }),
      createOscillator: () => Object.assign(startable("oscillator"), { frequency: param(0), type: "" }),
      createBufferSource: () => Object.assign(startable("bufferSource"), { buffer: null, loop: false }),
    };
  }

  test("未知音色报错，而不是产出静默的图", () => {
    const fake = createFakeAudioContext();
    assert.throws(() => buildAudioGraph(fake, "不存在的音色", fake.destination), RangeError);
  });

  test("五种音色都能构建并启动，且没有任何音源被二次启动", () => {
    for (const preset of AUDIO_PRESETS) {
      const fake = createFakeAudioContext();
      const graph = buildAudioGraph(fake, preset.id, fake.destination);
      assert.doesNotThrow(() => graph.start(), preset.id + " 启动时不应抛错");
      assert.equal(
        fake.__doubleStarts.length,
        0,
        preset.id + " 存在被二次启动的音源：" + fake.__doubleStarts.join(","),
      );
      assert.ok(fake.__started.length > 0, preset.id + " 应当至少启动一个音源");
      graph.stop(); // 清掉篝火音的定时器，避免测试进程被挂住
    }
  });

  test("用到 LFO 的音色必须把振荡器留给 start() 启动（回归：这三个音色曾全部静音）", () => {
    for (const id of ["rain", "stream", "waves"]) {
      const fake = createFakeAudioContext();
      const graph = buildAudioGraph(fake, id, fake.destination);
      assert.equal(
        fake.__started.length,
        0,
        id + " 在构建阶段就启动了音源，这会导致 start() 时二次调用并抛错",
      );
      graph.start();
      const oscillators = fake.__started.filter((entry) => entry.indexOf("oscillator") === 0);
      assert.ok(oscillators.length > 0, id + " 应当启动 LFO 振荡器");
      assert.equal(new Set(oscillators).size, oscillators.length, id + " 同一个振荡器被启动了多次");
      graph.stop();
    }
  });

  test("同一张图重复 start() 是幂等的", () => {
    const fake = createFakeAudioContext();
    const graph = buildAudioGraph(fake, "waves", fake.destination);
    graph.start();
    const afterFirst = fake.__started.length;
    graph.start();
    assert.equal(fake.__started.length, afterFirst, "重复 start() 不应再启动任何音源");
    assert.equal(fake.__doubleStarts.length, 0);
    graph.stop();
  });
});

// ─────────────────────────────────────────────────────────────
describe("ai · 场景化文案", () => {
  test("提示词明确禁止编造数据与使用 emoji", () => {
    assert.match(AI_SYSTEM_PROMPT, /不要编造/);
    assert.match(AI_SYSTEM_PROMPT, /emoji/);
    assert.match(AI_SYSTEM_PROMPT, /30 个汉字/);
  });

  test("buildMessages 只发送结构化场景事实", () => {
    const messages = buildMessages(detectScene(at(2026, 9, 4, 23, 30)));
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, "system");
    assert.equal(messages[1].role, "user");
    assert.match(messages[1].content, /周五晚/);
    // 不应把任何用户数据带进提示词
    assert.doesNotMatch(messages[1].content, /apiKey|password|白名单/);
  });

  test("sanitizeCopy 去掉引号、前缀与多余换行", () => {
    assert.equal(sanitizeCopy("「今晚早点睡。」"), "今晚早点睡。");
    assert.equal(sanitizeCopy("文案：今天结束了。"), "今天结束了。");
    assert.equal(sanitizeCopy("  晚安\n\n好梦  "), "晚安 好梦");
    assert.equal(sanitizeCopy('"周五了，睡个好觉。"'), "周五了，睡个好觉。");
  });

  test("sanitizeCopy 只保留第一句并限制长度", () => {
    assert.equal(sanitizeCopy("早点睡。明天还有事。"), "早点睡。");
    const long = sanitizeCopy("啊".repeat(200));
    assert.ok(long.length <= 60);
    assert.ok(long.endsWith("…"));
  });

  test("sanitizeCopy 对非字符串输入返回空串", () => {
    assert.equal(sanitizeCopy(null), "");
    assert.equal(sanitizeCopy(undefined), "");
    assert.equal(sanitizeCopy(123), "");
  });

  test("未配置 Key 时不发起任何网络请求", async () => {
    let called = false;
    const client = createAIClient({
      getConfig: () => ({ enabled: false, apiKey: "" }),
      fetchImpl: async () => { called = true; return { ok: true, json: async () => ({}) }; },
    });
    const result = await client.generate(detectScene(at(2026, 9, 4, 23, 30)));
    assert.deepEqual(result, { ok: false, reason: "disabled" });
    assert.equal(called, false, "禁用状态下不应有网络请求");
  });

  test("成功调用后会缓存，同一天同一场景不再重复请求", async () => {
    let calls = 0;
    const cache = createMemoryStorage();
    const client = createAIClient({
      getConfig: () => ({ enabled: true, apiKey: "sk-test", model: "m", baseUrl: "https://example.com/v1", timeoutMs: 5000 }),
      cache,
      fetchImpl: async () => {
        calls += 1;
        return { ok: true, json: async () => ({ choices: [{ message: { content: "周五了，今晚睡个好觉。" } }] }) };
      },
    });

    const scene = detectScene(at(2026, 9, 4, 23, 30));
    const first = await client.generate(scene);
    assert.equal(first.ok, true);
    assert.equal(first.cached, false);
    assert.equal(first.text, "周五了，今晚睡个好觉。");

    const second = await client.generate(detectScene(at(2026, 9, 4, 23, 45)));
    assert.equal(second.cached, true);
    assert.equal(calls, 1, "第二次应命中缓存");
  });

  test("HTTP 失败时返回原因而不是抛错，且不泄露响应体", async () => {
    const client = createAIClient({
      getConfig: () => ({ enabled: true, apiKey: "sk-secret", model: "m", baseUrl: "https://example.com/v1", timeoutMs: 5000 }),
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: "sk-secret 无效" }) }),
    });
    const result = await client.generate(detectScene(at(2026, 9, 4, 23, 30)));
    assert.deepEqual(result, { ok: false, reason: "http-429" });
    assert.equal(JSON.stringify(result).includes("sk-secret"), false, "错误信息不得包含 Key");
  });

  test("网络异常时降级而不抛出", async () => {
    const client = createAIClient({
      getConfig: () => ({ enabled: true, apiKey: "k", model: "m", baseUrl: "https://example.com/v1", timeoutMs: 5000 }),
      fetchImpl: async () => { throw new TypeError("Failed to fetch"); },
    });
    assert.deepEqual(await client.generate(detectScene(at(2026, 9, 4, 23, 30))), { ok: false, reason: "network" });
  });
});

// ─────────────────────────────────────────────────────────────
describe("engine · 状态引擎与紧急解除", () => {
  const MONDAY_NIGHT = at(2026, 8, 31, 23, 30); // 周一 23:30，处于工作日时段内

  async function createHarness(startAt = MONDAY_NIGHT) {
    let currentTime = startAt;
    const storage = createMemoryStorage();
    const settingsStore = createSettingsStore({ storage });
    const passwordHash = await hashPassword("1234");
    settingsStore.update({ emergency: { passwordHash, quotaTotal: 2 }, onboarded: true });
    const quotaStore = createQuotaStore({ storage, total: 2 });
    const engine = createEngine({ settingsStore, quotaStore, now: () => currentTime });
    return {
      engine,
      settingsStore,
      quotaStore,
      setTime: (next) => { currentTime = next; },
      advanceMs: (ms) => { currentTime = new Date(currentTime.getTime() + ms); },
    };
  }

  test("周一 23:30 处于 ACTIVE，且剩余时长指向次日 07:00", async () => {
    const harness = await createHarness();
    const snapshot = harness.engine.snapshot();
    assert.equal(snapshot.phase, PHASE.ACTIVE);
    assert.equal(snapshot.remainingMs, 7.5 * 3600_000);
    assert.equal(dateKey(snapshot.window.end), "2026-09-01");
  });

  test("错误密码不消耗额度（校验顺序：先密码后额度）", async () => {
    const harness = await createHarness();
    const before = harness.engine.snapshot().quota.remaining;
    const result = await harness.engine.emergencyUnlock("9999");
    assert.deepEqual(result, { ok: false, reason: "bad-password" });
    assert.equal(harness.engine.snapshot().quota.remaining, before, "密码错误不应扣额度");
    assert.equal(harness.engine.snapshot().phase, PHASE.ACTIVE, "仍应处于熄灯状态");
  });

  test("正确密码解除熄灯并扣减一次额度", async () => {
    const harness = await createHarness();
    const result = await harness.engine.emergencyUnlock("1234");
    assert.deepEqual(result, { ok: true, remaining: 1 });

    const snapshot = harness.engine.snapshot();
    assert.equal(snapshot.phase, PHASE.OFF, "解除后当日熄灯失效");
    assert.equal(snapshot.dismissed, true);
    assert.equal(snapshot.dismissedWindowKey, "2026-08-31");
  });

  test("非熄灯状态下不允许解除（不浪费额度）", async () => {
    const harness = await createHarness(at(2026, 8, 31, 20, 0));
    assert.deepEqual(await harness.engine.emergencyUnlock("1234"), { ok: false, reason: "not-active" });
    assert.equal(harness.engine.snapshot().quota.remaining, 2);
  });

  test("解除后的当天不再重新进入，次日按计划自动恢复", async () => {
    const harness = await createHarness();
    await harness.engine.emergencyUnlock("1234");

    // 同一次时段内继续推进到凌晨 03:00，仍应保持解除状态
    harness.setTime(at(2026, 9, 1, 3, 0));
    assert.equal(harness.engine.snapshot().phase, PHASE.OFF, "同一次时段内不应重新接管");

    // 到了下一个时段（周二 23:30）应自动恢复
    harness.setTime(at(2026, 9, 1, 23, 30));
    assert.equal(harness.engine.snapshot().phase, PHASE.ACTIVE, "次日计划应自动生效");
  });

  test("额度用尽后无法再解除", async () => {
    const harness = await createHarness();
    assert.equal((await harness.engine.emergencyUnlock("1234")).ok, true);

    harness.setTime(at(2026, 9, 1, 23, 30));
    assert.equal((await harness.engine.emergencyUnlock("1234")).ok, true);
    assert.equal(harness.engine.snapshot().quota.remaining, 0);

    harness.setTime(at(2026, 9, 2, 23, 30));
    assert.deepEqual(await harness.engine.emergencyUnlock("1234"), { ok: false, reason: "quota-exhausted" });
    assert.equal(harness.engine.snapshot().phase, PHASE.ACTIVE, "额度用尽后必须继续熄灯");
  });

  test("未设置密码时无法解除", async () => {
    const storage = createMemoryStorage();
    const settingsStore = createSettingsStore({ storage });
    const quotaStore = createQuotaStore({ storage, total: 2 });
    const engine = createEngine({ settingsStore, quotaStore, now: () => MONDAY_NIGHT });
    assert.deepEqual(await engine.emergencyUnlock("0000"), { ok: false, reason: "no-password" });
  });

  test("AI 文案优先于本地轮播，清空后恢复轮播", async () => {
    const harness = await createHarness();
    const localCopy = harness.engine.snapshot().copy;
    assert.notEqual(localCopy.kind, "ai");

    harness.engine.setAIText("今晚是周一，早点睡。");
    const aiCopy = harness.engine.snapshot().copy;
    assert.equal(aiCopy.kind, "ai");
    assert.equal(aiCopy.text, "今晚是周一，早点睡。");

    harness.engine.setAIText(null);
    assert.notEqual(harness.engine.snapshot().copy.kind, "ai");
  });

  test("轮播推进不会抛错，且始终有文案", async () => {
    const harness = await createHarness();
    const seen = new Set();
    for (let i = 0; i < 40; i += 1) {
      const item = harness.engine.rotateCopy();
      assert.ok(item && typeof item.text === "string" && item.text.length > 0);
      seen.add(item.id);
    }
    assert.ok(seen.size > 5, "40 次推进应覆盖多条文案");
  });
});
