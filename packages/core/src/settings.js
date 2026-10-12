/**
 * 熄灯早睡 · 设置读写与版本迁移
 *
 * 设置是"用户唯一需要长期信任的数据"，因此这里的重点是可恢复性：
 * 任何字段缺失、类型错误、版本过期，都通过 `migrateSettings` 收敛到合法状态，
 * 而不是把问题抛给上层 UI。
 */

import { DEFAULT_SETTINGS, SETTINGS_VERSION } from "./constants.js";
import { clone, createStore, deepMerge, resolveStorage } from "./storage.js";

export const SETTINGS_KEY = "xideng.settings.v1";

/** 把任意输入收敛为合法的设置对象 */
export function migrateSettings(raw) {
  const merged = deepMerge(clone(DEFAULT_SETTINGS), raw && typeof raw === "object" ? raw : {});

  merged.version = SETTINGS_VERSION;

  // --- plan ---
  merged.plan.enabled = Boolean(merged.plan.enabled);
  for (const dayType of ["weekday", "weekend"]) {
    const window = merged.plan.windows?.[dayType];
    if (!window || typeof window.start !== "string" || typeof window.end !== "string") {
      merged.plan.windows[dayType] = clone(DEFAULT_SETTINGS.plan.windows[dayType]);
    }
  }
  merged.plan.warnMinutes = clampNumber(merged.plan.warnMinutes, 0, 120, DEFAULT_SETTINGS.plan.warnMinutes);

  // --- blackout ---
  merged.blackout.brightness = clampNumber(merged.blackout.brightness, 0.15, 1, DEFAULT_SETTINGS.blackout.brightness);
  merged.blackout.copyIntervalSec = clampNumber(
    merged.blackout.copyIntervalSec,
    5,
    120,
    DEFAULT_SETTINGS.blackout.copyIntervalSec,
  );

  // --- whitelist ---
  merged.whitelist.totalMinutes = clampNumber(merged.whitelist.totalMinutes, 5, 60, DEFAULT_SETTINGS.whitelist.totalMinutes);
  if (!Array.isArray(merged.whitelist.apps)) merged.whitelist.apps = [];
  merged.whitelist.apps = merged.whitelist.apps
    .filter((app) => app && typeof app.id === "string" && typeof app.name === "string")
    .map((app) => ({
      id: app.id,
      name: app.name,
      system: Boolean(app.system),
      removable: app.removable !== false,
      countsAgainstQuota: app.countsAgainstQuota !== false,
      uri: typeof app.uri === "string" ? app.uri : "",
      // 自定义应用的打开地址必须保留，否则用户添加的应用会变成"打不开"的空壳
      url: typeof app.url === "string" ? app.url : "",
      description: typeof app.description === "string" ? app.description : "",
    }));

  // 系统应用必须始终在列且不可移除（PRD 2.2.3）
  for (const systemApp of DEFAULT_SETTINGS.whitelist.apps) {
    const existing = merged.whitelist.apps.find((app) => app.id === systemApp.id);
    if (!existing) merged.whitelist.apps.unshift(clone(systemApp));
    else {
      existing.system = true;
      existing.removable = false;
      existing.countsAgainstQuota = false;
    }
  }

  // --- audio ---
  merged.audio.volume = clampNumber(merged.audio.volume, 0, 1, DEFAULT_SETTINGS.audio.volume);
  merged.audio.durationMinutes = clampNumber(merged.audio.durationMinutes, 0, 600, DEFAULT_SETTINGS.audio.durationMinutes);
  merged.audio.autoPlay = Boolean(merged.audio.autoPlay);

  // --- ai ---
  merged.ai.enabled = Boolean(merged.ai.enabled);
  merged.ai.apiKey = typeof merged.ai.apiKey === "string" ? merged.ai.apiKey : "";
  merged.ai.baseUrl = typeof merged.ai.baseUrl === "string" && merged.ai.baseUrl ? merged.ai.baseUrl : DEFAULT_SETTINGS.ai.baseUrl;
  merged.ai.model = typeof merged.ai.model === "string" && merged.ai.model ? merged.ai.model : DEFAULT_SETTINGS.ai.model;
  merged.ai.temperature = clampNumber(merged.ai.temperature, 0, 2, DEFAULT_SETTINGS.ai.temperature);
  merged.ai.timeoutMs = clampNumber(merged.ai.timeoutMs, 2000, 60_000, DEFAULT_SETTINGS.ai.timeoutMs);

  // --- emergency ---
  merged.emergency.passwordHash = typeof merged.emergency.passwordHash === "string" ? merged.emergency.passwordHash : "";
  merged.emergency.quotaTotal = clampNumber(merged.emergency.quotaTotal, 0, 14, DEFAULT_SETTINGS.emergency.quotaTotal);
  // 忘记密码重置申请时间戳：只接受合法数字，其余一律视为未申请
  merged.emergency.passwordResetAt =
    typeof merged.emergency.passwordResetAt === "number" && Number.isFinite(merged.emergency.passwordResetAt)
      ? merged.emergency.passwordResetAt
      : null;

  // --- guard ---
  merged.guard.reassertOnVisible = Boolean(merged.guard.reassertOnVisible);
  merged.guard.detectClockTamper = Boolean(merged.guard.detectClockTamper);
  merged.guard.wakeLock = Boolean(merged.guard.wakeLock);

  // --- 已废弃字段清理：只保留 DEFAULT_SETTINGS 中声明过的键 ---
  return pickKnownKeys(merged, DEFAULT_SETTINGS);
}

function pickKnownKeys(source, shape) {
  const result = {};
  for (const [key, shapeValue] of Object.entries(shape)) {
    if (shapeValue && typeof shapeValue === "object" && !Array.isArray(shapeValue)) {
      result[key] = pickKnownKeys(source?.[key] ?? {}, shapeValue);
    } else {
      result[key] = source?.[key] ?? shapeValue;
    }
  }
  return result;
}

function clampNumber(value, min, max, fallback) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

/**
 * 设置仓库。`subscribe` 让多个视图（设置页、黑屏页、个人中心）保持一致。
 * @param {{storage?: object}} [options]
 */
export function createSettingsStore({ storage } = {}) {
  const resolved = resolveStorage(storage ?? globalThis.localStorage);
  const store = createStore({ storage: resolved, key: SETTINGS_KEY, defaults: DEFAULT_SETTINGS });
  const listeners = new Set();
  let current = migrateSettings(store.read());

  function emit() {
    for (const listener of listeners) {
      try {
        listener(current);
      } catch (error) {
        // 单个订阅者出错不应影响其它订阅者
        console.error("[xideng] settings listener failed", error);
      }
    }
  }

  // 首次读取即落一次迁移结果，保证磁盘上永远是当前版本的结构
  store.write(current);

  return {
    get value() {
      return current;
    },

    /** 合并式更新 */
    update(partial) {
      current = migrateSettings(deepMerge(current, partial));
      store.write(current);
      emit();
      return current;
    },

    replace(next) {
      current = migrateSettings(next);
      store.write(current);
      emit();
      return current;
    },

    reset() {
      current = migrateSettings(DEFAULT_SETTINGS);
      store.write(current);
      emit();
      return current;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** 供调试面板与测试使用 */
    get storage() {
      return resolved;
    },
  };
}
