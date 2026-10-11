/**
 * 熄灯早睡 · 防绕过守卫
 *
 * 对应 PRD 三「防绕过安全防护体系」。**必须诚实说明能力的边界**：
 * 浏览器沙箱里没有任何 API 可以真正"阻止用户切换到微信"，因此 Web/PWA 端实现的是
 * **等效防护**——它能保证"熄灯状态本身"不被绕过（改时间、切走、刷新、后退都甩不掉），
 * 但无法阻止用户去用别的 App。原生端（platforms/android）才具备系统级接管能力。
 *
 * 这个边界已写进 README 与赛事作品说明，不做夸大宣传。
 */

import { CLOCK_TAMPER_TOLERANCE_MS } from "./constants.js";

/**
 * 系统时间篡改检测：用单调时钟（performance.now）作为参照，
 * 若墙上时钟与单调时钟的增量出现明显偏差，说明用户改了系统时间。
 *
 * @param {{now?: () => number, monotonic?: () => number, toleranceMs?: number, onJump?: Function}} [options]
 */
export function createClockGuard(options = {}) {
  const {
    now = () => Date.now(),
    monotonic = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
    toleranceMs = CLOCK_TAMPER_TOLERANCE_MS,
    onJump,
  } = options;

  let lastWall = now();
  let lastMonotonic = monotonic();

  return {
    /** 取一次样本；没有异常返回 null */
    sample() {
      const wall = now();
      const mono = monotonic();
      const wallDelta = wall - lastWall;
      const monoDelta = mono - lastMonotonic;
      const drift = wallDelta - monoDelta;

      lastWall = wall;
      lastMonotonic = mono;

      if (Math.abs(drift) <= toleranceMs) return null;

      const event = {
        drift,
        direction: drift > 0 ? "forward" : "backward",
        wallTime: wall,
        monotonicTime: mono,
        // 向前改时间可能是想跳过熄灯时段；向后改可能是想重复触发，两者都要拦
        at: new Date(wall).toISOString(),
      };
      onJump?.(event);
      return event;
    },

    reset() {
      lastWall = now();
      lastMonotonic = monotonic();
    },
  };
}

/**
 * 页面可见性守卫：熄灯时段内用户切走后，一回来立刻重新接管（PRD 2.2.1
 * "用户解锁设备后将直接进入熄灯黑屏界面"的 Web 等效实现）。
 */
export function createVisibilityGuard({ document: doc = globalThis.document, now = () => new Date(), onChange } = {}) {
  if (!doc?.addEventListener) return { dispose() {} };
  const handler = () => onChange?.({ hidden: doc.hidden, at: now() });
  doc.addEventListener("visibilitychange", handler);
  return {
    dispose() {
      doc.removeEventListener("visibilitychange", handler);
    },
  };
}

/**
 * 连续点击计数器。PRD 2.2.5：连续点击屏幕 5 次触发紧急解除入口。
 * 超出时间窗则重新计数，避免用户零散点击意外触发。
 */
export function createTapCounter({
  required = 5,
  windowMs = 3000,
  now = () => Date.now(),
  onTrigger,
} = {}) {
  let timestamps = [];

  return {
    tap() {
      const current = now();
      timestamps = timestamps.filter((time) => current - time <= windowMs);
      timestamps.push(current);
      if (timestamps.length >= required) {
        timestamps = [];
        onTrigger?.({ at: new Date(current) });
        return { triggered: true, progress: 0, remaining: required };
      }
      return { triggered: false, progress: timestamps.length, remaining: required - timestamps.length };
    },
    reset() {
      timestamps = [];
    },
    get progress() {
      return timestamps.length;
    },
  };
}

/**
 * 请求屏幕唤醒锁，避免熄屏导致计时与轮播被浏览器节流。
 * 不支持时静默返回 null——这是增强能力，不是必需能力。
 */
export async function requestWakeLock(navigatorLike = globalThis.navigator) {
  try {
    if (!navigatorLike?.wakeLock?.request) return null;
    const sentinel = await navigatorLike.wakeLock.request("screen");
    return sentinel;
  } catch {
    return null;
  }
}

/**
 * 历史栈围栏：熄灯时段内拦截"返回键退出"。
 * 每次成功后退都重新压入一条历史记录，使后退操作无法离开黑屏界面。
 */
export function installHistoryTrap(historyLike = globalThis.history, onBack) {
  if (!historyLike?.pushState) return { dispose() {} };

  historyLike.pushState({ xideng: "blackout" }, "");
  const handler = () => {
    onBack?.();
    historyLike.pushState({ xideng: "blackout" }, "");
  };
  globalThis.addEventListener?.("popstate", handler);

  return {
    dispose() {
      globalThis.removeEventListener?.("popstate", handler);
    },
  };
}

/**
 * 熄屏/失焦期间的时间完整性校验。
 * 浏览器在后台会节流定时器，因此不能假设"每秒都跑到了"；
 * 每帧都应以真实时钟重算剩余时长，而不是做自减计数。
 */
export function createTickScheduler({ onTick, intervalMs = 250, setIntervalImpl, clearIntervalImpl } = {}) {
  const setIntervalFn = setIntervalImpl ?? globalThis.setInterval;
  const clearIntervalFn = clearIntervalImpl ?? globalThis.clearInterval;
  let handle = null;

  return {
    start() {
      if (handle !== null) return;
      onTick?.();
      handle = setIntervalFn(() => onTick?.(), intervalMs);
    },
    stop() {
      if (handle === null) return;
      clearIntervalFn(handle);
      handle = null;
    },
    get running() {
      return handle !== null;
    },
  };
}
