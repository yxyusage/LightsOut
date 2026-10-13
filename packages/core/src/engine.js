/**
 * 熄灯早睡 · 状态引擎
 *
 * 把"计划 + 场景 + 文案 + 额度 + 紧急解除"组合成一个可被任何端消费的快照。
 * 引擎自身**不持有定时器、不操作 DOM、不读系统时间**，因此：
 *  - Web 端用 requestAnimationFrame / setInterval 驱动它；
 *  - 桌面端用 .NET 的 DispatcherTimer 驱动它；
 *  - 测试里用伪造时钟任意"穿越时间"驱动它。
 */

import { EXCEPTION_MAX_MINUTES } from "./ai.js";
import { COPY_ROTATE_MS, PASSWORD_RESET_COOLDOWN_MS, PHASE } from "./constants.js";
import { buildPlaylist, createRotator, hashString } from "./copy.js";
import { verifyPassword } from "./password.js";
import { detectScene } from "./scene.js";
import { phaseAt } from "./schedule.js";

/**
 * @param {{
 *   settingsStore: {value: object},
 *   quotaStore: object,
 *   now?: () => Date,
 *   copyIntervalMs?: number,
 *   getWhitelistRemainingMs?: () => number
 * }} options
 */
export function createEngine({ settingsStore, quotaStore, now = () => new Date(), copyIntervalMs, getWhitelistRemainingMs } = {}) {
  /** 被紧急解除的时段键（该时段开始日的 YYYY-MM-DD）；null 表示未解除 */
  let dismissedWindowKey = null;

  let playlist = null;
  let playlistKey = null;
  let rotator = null;
  /** AI 生成的文案，优先级高于本地轮播 */
  let aiText = null;

  /**
   * AI 裁定通过的「今晚例外」。
   *
   * 只放宽**当前时段的结束时间**，不取消熄灯、不改用户设定的时段。
   * 换到新时段自动失效（靠 windowKey 比对），因此不会累积成"永久放宽"。
   */
  let tonightException = null;

  // ── 忘记密码兜底（PRD 增强）：等待 24 小时后重置密码 ──

  /**
   * 惰性结算：若重置申请已过 24 小时冷却，则清空密码并清除申请。
   * 在快照与解除入口处都会被调用，保证"到期即生效"不依赖额外定时器。
   *
   * ⚠️ 这里**刻意不动每周额度**。
   * 早先的实现顺带调了 `quotaStore.reset(at)`，等于每 24 小时白送 2 次紧急解除，
   * 把 PRD 2.1.3 的「每周 2 次」从 2 次/周放大到约 14 次/周，这条机制被彻底架空
   * ——「防止靠重置免费越狱」的设计反而自己开了后门。
   * 忘记密码只是拿回「设置新密码」的能力，额度该扣的已经扣了。
   *
   * @returns {boolean} 是否刚完成了一次结算。
   */
  function settlePasswordReset(at) {
    const requestedAt = settingsStore.value.emergency?.passwordResetAt;
    if (!requestedAt || typeof requestedAt !== "number") return false;
    if (at.getTime() - requestedAt < PASSWORD_RESET_COOLDOWN_MS) return false;

    settingsStore.update({ emergency: { passwordResetAt: null, passwordHash: "" } });
    return true;
  }

  /**
   * 忘记密码重置状态。
   * @returns {{pending: boolean, remainingMs: number, requestedAt: number|null}}
   */
  function passwordResetInfo(at) {
    settlePasswordReset(at);
    const requestedAt = settingsStore.value.emergency?.passwordResetAt;
    if (!requestedAt || typeof requestedAt !== "number") {
      return { pending: false, remainingMs: 0, requestedAt: null };
    }
    return {
      pending: true,
      remainingMs: Math.max(0, PASSWORD_RESET_COOLDOWN_MS - (at.getTime() - requestedAt)),
      requestedAt,
    };
  }

  /** 申请重置（已有未到期的申请时不重复覆盖）。 */
  function requestPasswordReset(at) {
    if (passwordResetInfo(at).pending) return passwordResetInfo(at);
    settingsStore.update({ emergency: { passwordResetAt: at.getTime() } });
    return passwordResetInfo(at);
  }

  function ensurePlaylist(scene) {
    const key = `${scene.dateKey}|${scene.scene}`;
    if (key === playlistKey && rotator) return;
    const configuredMs = Number(settingsStore.value.blackout.copyIntervalSec) * 1000;
    const interval = Number.isFinite(copyIntervalMs)
      ? copyIntervalMs
      : Number.isFinite(configuredMs) && configuredMs > 0
        ? configuredMs
        : COPY_ROTATE_MS;
    playlist = buildPlaylist(scene, { seed: hashString(key) });
    rotator = createRotator({ entries: playlist, intervalMs: interval });
    playlistKey = key;
  }

  /**
   * 当前状态快照。UI 每一帧都调用它，因此实现上避免重复分配大对象。
   */
  function snapshot() {
    const settings = settingsStore.value;
    const at = now();
    const phaseInfo = phaseAt(settings.plan, at, {
      warnMinutes: settings.plan.warnMinutes,
      dismissedWindowKey,
      sundayAsWeekday: settings.plan.sundayAsWeekday,
    });
    // ── 应用「今晚例外」：只把结束时间往后推，不改相位 ──
    // 相位是 phaseAt 按原时段算好的；既然只是延长结束时间，
    // 当前处于 ACTIVE 的判定不会改变，因此不必重算，只需修正结束时间与剩余时长。
    let effectiveWindow = phaseInfo.window;
    let effectiveRemainingMs = phaseInfo.remainingMs;
    if (
      tonightException &&
      effectiveWindow &&
      tonightException.windowKey === effectiveWindow.startKey &&
      tonightException.extraMs > 0
    ) {
      effectiveWindow = Object.freeze({
        ...effectiveWindow,
        end: new Date(effectiveWindow.end.getTime() + tonightException.extraMs),
        extendedByMs: tonightException.extraMs,
      });
      effectiveRemainingMs += tonightException.extraMs;
    } else if (tonightException && effectiveWindow && tonightException.windowKey !== effectiveWindow.startKey) {
      // 已经跨到下个时段，旧例外自动失效
      tonightException = null;
    }

    const scene = detectScene(at);
    ensurePlaylist(scene);

    const copy = aiText
      ? { id: "ai", kind: "ai", text: aiText, source: "ai" }
      : rotator.current();

    return {
      at,
      settings,
      scene,
      quota: quotaStore.snapshot(at),
      passwordReset: passwordResetInfo(at),
      phase: phaseInfo.phase,
      window: effectiveWindow,
      remainingMs: effectiveRemainingMs,
      /** 今晚的 AI 例外（无则为 null），界面用它展示"AI 已放宽 45 分钟" */
      exception: tonightException,
      warnMs: phaseInfo.warnMs,
      dismissed: phaseInfo.dismissed,
      /** 是否为"用户主动解除后当日失效"状态 */
      dismissedWindowKey,
      copy,
      copyIntervalMs: rotator.intervalMs,
      copyTotal: rotator.length,
      /** 白名单剩余可用时长（秒），仅统计占用额度的应用。
       *  由应用层注入真实预算读取（app.js 传入 budget.remainingMs）；
       *  未注入时回退为总额，避免出现"负剩余"的误导。 */
      whitelistRemainingMs: Math.max(0,
        getWhitelistRemainingMs
          ? getWhitelistRemainingMs()
          : settings.whitelist.totalMinutes * 60_000),
    };
  }

  return {
    snapshot,

    /** 推进到下一句文案（由 UI 的定时器调用） */
    rotateCopy() {
      // 允许在首次 snapshot 之前调用：按需先把播放列表准备好
      if (!rotator) ensurePlaylist(detectScene(now()));
      return rotator.next();
    },

    /** 跳回播放列表开头（重新进入熄灯模式时调用，保证每次从第一句开始） */
    resetCopy() {
      if (!rotator) ensurePlaylist(detectScene(now()));
      return playlist?.length ? rotator.jumpTo(playlist[0].id) : rotator.current();
    },

    /** 注入 AI 文案；传 null 恢复本地轮播 */
    setAIText(text) {
      aiText = typeof text === "string" && text.trim() ? text.trim() : null;
      return aiText;
    },

    get aiText() {
      return aiText;
    },

    get playlist() {
      return playlist;
    },

    /**
     * 紧急解除（PRD 2.2.5）。
     * 校验顺序刻意设计为「先密码、后额度」——密码错误不应消耗用户宝贵的解除次数。
     *
     * @returns {Promise<{ok: true, remaining: number} | {ok: false, reason: string}>}
     */
    async emergencyUnlock(password) {
      const settings = settingsStore.value;
      const at = now();

      if (!settings.emergency.passwordHash) return { ok: false, reason: "no-password" };

      const phaseInfo = phaseAt(settings.plan, at, {
        warnMinutes: settings.plan.warnMinutes,
        dismissedWindowKey,
        sundayAsWeekday: settings.plan.sundayAsWeekday,
      });
      if (phaseInfo.phase !== PHASE.ACTIVE) return { ok: false, reason: "not-active" };

      const valid = await verifyPassword(password, settings.emergency.passwordHash);
      if (!valid) return { ok: false, reason: "bad-password" };

      // 密码正确 → 说明用户其实记得密码，顺带撤销可能存在的重置申请。
      //
      // ⚠️ 早先把 pending 检查放在密码校验**之前**，导致误点「忘记密码」的用户
      // 即使密码记得清清楚楚也要干等 24 小时，而且没有任何取消入口。
      // 现在的顺序是：先验密码，验过了就把申请撤掉。
      if (settingsStore.value.emergency?.passwordResetAt) {
        settingsStore.update({ emergency: { passwordResetAt: null } });
      }

      const consumed = quotaStore.consume(at);
      if (!consumed.ok) return { ok: false, reason: "quota-exhausted" };

      // 只解除"当前这一次"时段，次日计划照常生效
      dismissedWindowKey = phaseInfo.window?.startKey ?? null;
      return { ok: true, remaining: consumed.remaining };
    },

    /**
     * 放宽今晚的熄灯结束时间。**消耗一次紧急解除额度** —— 这是刻意的：
     * 例外必须是有代价的，否则"跟 AI 说一声就能不锁"会直接摧毁产品的强制力。
     *
     * @param {{minutes: number, reason?: string, understood?: string}} decision AI 的裁定结果
     */
    grantException({ minutes, reason, understood } = {}) {
      const at = now();
      const settings = settingsStore.value;
      const phaseInfo = phaseAt(settings.plan, at, {
        warnMinutes: settings.plan.warnMinutes,
        dismissedWindowKey,
        sundayAsWeekday: settings.plan.sundayAsWeekday,
      });
      if (phaseInfo.phase !== PHASE.ACTIVE || !phaseInfo.window) {
        return { ok: false, reason: "not-active" };
      }

      const safeMinutes = Math.max(0, Math.min(EXCEPTION_MAX_MINUTES, Math.round(Number(minutes) || 0)));
      if (safeMinutes === 0) return { ok: false, reason: "no-extension" };

      // 先扣额度再记录：额度不足时不能留下一次"已经放宽"的状态
      const consumed = quotaStore.consume(at);
      if (!consumed.ok) return { ok: false, reason: "quota-exhausted" };

      tonightException = {
        windowKey: phaseInfo.window.startKey,
        extraMs: safeMinutes * 60_000,
        reason: String(reason ?? "").slice(0, 80),
        understood: String(understood ?? "").slice(0, 60),
      };
      return { ok: true, minutes: safeMinutes, remaining: consumed.remaining };
    },

    /** 当前生效的例外（供界面展示），已过期则返回 null */
    get exception() {
      return tonightException;
    },

    /** 重新武装（跨时段或用户手动恢复计划时调用） */
    rearm() {
      dismissedWindowKey = null;
      tonightException = null;
    },

    /** 忘记密码：申请 24 小时后重置密码（不影响每周额度） */
    requestPasswordReset() {
      return requestPasswordReset(now());
    },

    /** 忘记密码重置状态（pending / remainingMs） */
    passwordResetInfo() {
      return passwordResetInfo(now());
    },

    /** 供调试面板查看 */
    get dismissed() {
      return dismissedWindowKey;
    },
  };
}
