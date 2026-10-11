/**
 * 熄灯早睡 · 状态引擎
 *
 * 把"计划 + 场景 + 文案 + 额度 + 紧急解除"组合成一个可被任何端消费的快照。
 * 引擎自身**不持有定时器、不操作 DOM、不读系统时间**，因此：
 *  - Web 端用 requestAnimationFrame / setInterval 驱动它；
 *  - 桌面端用 .NET 的 DispatcherTimer 驱动它；
 *  - 测试里用伪造时钟任意"穿越时间"驱动它。
 */

import { COPY_ROTATE_MS, PHASE } from "./constants.js";
import { buildPlaylist, createRotator, hashString } from "./copy.js";
import { verifyPassword } from "./password.js";
import { detectScene } from "./scene.js";
import { phaseAt } from "./schedule.js";

/**
 * @param {{
 *   settingsStore: {value: object},
 *   quotaStore: object,
 *   now?: () => Date,
 *   copyIntervalMs?: number
 * }} options
 */
export function createEngine({ settingsStore, quotaStore, now = () => new Date(), copyIntervalMs } = {}) {
  /** 被紧急解除的时段键（该时段开始日的 YYYY-MM-DD）；null 表示未解除 */
  let dismissedWindowKey = null;

  let playlist = null;
  let playlistKey = null;
  let rotator = null;
  /** AI 生成的文案，优先级高于本地轮播 */
  let aiText = null;

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
    });
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
      phase: phaseInfo.phase,
      window: phaseInfo.window,
      remainingMs: phaseInfo.remainingMs,
      warnMs: phaseInfo.warnMs,
      dismissed: phaseInfo.dismissed,
      /** 是否为"用户主动解除后当日失效"状态 */
      dismissedWindowKey,
      copy,
      copyIntervalMs: rotator.intervalMs,
      copyTotal: rotator.length,
      /** 白名单剩余可用时长（秒），仅统计占用额度的应用 */
      whitelistRemainingMs: Math.max(0, settings.whitelist.totalMinutes * 60_000),
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

      if (!settings.emergency.passwordHash) return { ok: false, reason: "no-password" };

      const at = now();
      const phaseInfo = phaseAt(settings.plan, at, {
        warnMinutes: settings.plan.warnMinutes,
        dismissedWindowKey,
      });
      if (phaseInfo.phase !== PHASE.ACTIVE) return { ok: false, reason: "not-active" };

      const valid = await verifyPassword(password, settings.emergency.passwordHash);
      if (!valid) return { ok: false, reason: "bad-password" };

      const consumed = quotaStore.consume(at);
      if (!consumed.ok) return { ok: false, reason: "quota-exhausted" };

      // 只解除"当前这一次"时段，次日计划照常生效
      dismissedWindowKey = phaseInfo.window?.startKey ?? null;
      return { ok: true, remaining: consumed.remaining };
    },

    /** 重新武装（跨时段或用户手动恢复计划时调用） */
    rearm() {
      dismissedWindowKey = null;
    },

    /** 供调试面板查看 */
    get dismissed() {
      return dismissedWindowKey;
    },
  };
}
